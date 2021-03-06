const rp = require('request-promise')
const WebSocket = require('ws');
const Ortak = require('./ortak')

class WsDepth {
    async LoadVeriables(ortak) {
        this.islemKati = 10
        this.minFark = 1
        this.islemdekiCoinler = []
        this.ortak = new Ortak()
        await this.ortak.LoadVeriables('MONGO')
        this.balances = []
        this.oncekiCoin = null
        this.depths = []
        this.orderBookCount = 10
        this.subSayac = 0
        this.wsZamanlayici = 15
    }

    async GetMarkets(){
        const allTickers = await this.ortak.ccx.GetMarkets().catch(async (e)=>{
            if(e.message.includes('per second')){
                await this.ortak.sleep(11)
            }
            console.log(e)
        } )
        if(!allTickers || !allTickers.Data) return await this.GetMarkets()
        return allTickers.Data
    }

    async PrepareDbAndGetUygunMarkets(){
        let allTickers = await this.GetMarkets()
        const allMarkets = allTickers.map(e=> e.Label)
        const mainMarkets = ['LTC/BTC', 'DOGE/LTC', 'DOGE/BTC']
        const yasakliMarkets = ['NZDT', 'USDT']

        const umFilter = allTickers.filter(x=>{
            const coin = x.Label.split('/')[0]
            const baseCoin = x.Label.split('/')[1]
            const markets = [coin + '/BTC', coin + '/LTC', coin + '/DOGE']
            if(mainMarkets.includes(x.Label)) return true
            if(yasakliMarkets.includes(baseCoin)) return false
            const butunMarketlerdeVar = allMarkets.includes(markets[0]) && allMarkets.includes(markets[1]) && allMarkets.includes(markets[2]) //&& x.Volume > 0.1
            return butunMarketlerdeVar
        })

        //this.ortak.depths = umFilter.map(x=> ({ tradePairId: x['TradePairId'], market: x['Label']}))
        const umMap = umFilter.map(x=> ({ tradePairId: x['TradePairId'], market: x['Label']}))

        await this.ortak.depths.deleteMany({})
        await this.ortak.depths.insertMany(umMap)     
    }

    async OrderBookInsert(data, callback){
        //const depths = this.ortak.depths.find(e=> e.tradePairId == data.TradePairId) //await this.ortak.depths.findOne({ 'tradePairId': data['TradePairId'] })
        let depths = await this.ortak.depths.findOne({ tradePairId: data.TradePairId }) 
        if(!depths || !depths.depths.asks || !depths.depths.bids) return
        
        if(data['Type'] == 1 && depths.depths.asks.length > 9 && data.Rate > depths.depths.asks[9].rate) return 
        if(data['Type'] == 0 && depths.depths.bids.length > 9 && data.Rate < depths.depths.bids[9].rate) return 

        let bids = [], asks = [], yeniMix, newDepths
        
        if(depths['depths']['bids'].length > 0)
            bids = depths['depths']['bids']

        if(depths['depths']['asks'].length > 0)
            asks = depths['depths']['asks']

        const mix = bids.concat(asks)
        if(data['Action'] == 0) // add
            yeniMix = this.OrderEkle(data, mix)
        
        if(data['Action'] == 3) // sil (iptal)
            yeniMix = this.OrderSil(data, mix)

        if(data['Action'] == 1) // sil (işlem yapıldı buy yada sell)
            yeniMix = this.OrderSil(data, mix)


        //asks = list(filter(lambda x: x['type'] == 'asks', mix))
        asks = yeniMix.filter(e=> e['type'] == 'asks')
        asks.sort((a,b)=> a.rate - b.rate)
        asks = asks.slice(0, this.orderBookCount)
        //asks.sort()
        //asks = sorted(asks, key=lambda x: x['rate'])

        //bids = list(filter(lambda x: x['type'] == 'bids', mix))
        bids = yeniMix.filter(e=> e['type'] == 'bids')
        bids.sort((a,b)=> b.rate - a.rate)
        bids = bids.slice(0, this.orderBookCount)
        //bids = sorted(bids, key=lambda x: x['rate'],  reverse=True)
        

        newDepths = {'bids': bids, 'asks': asks }
        await this.ortak.depths.updateOne({tradePairId: data.TradePairId}, {'$set': {'depths': newDepths}})
        /*
        const depth = this.ortak.depths.find(e=>{
            if(e.tradePairId == data.TradePairId){
                e.depths = newDepths
                return true
            }
        })

        const ratem = yeniMix.find(e=> e['rate'] == data['Rate'])
        const indexim = data['Type'] == 1 ? asks.findIndex(e=> e['rate'] == data['Rate']) :  bids.findIndex(e=> e['rate'] == data['Rate'])

        if(callback && !this.ortak.wsDataProcessing && data.Action == 0 && indexim == 0 && ratem){// #and steamBasla:
            const coin = depth.market.split('/')[0]
            callback(coin)
        }
        */
    }
    
    OrderEkle(data, orderBooks){
        //rateExist = list(filter(lambda x: x['rate'] == data['Rate'],orderBooks))
        let rateExist = orderBooks.find(e=> e['rate'] == data['Rate'])
        if (rateExist){
            rateExist['amount'] = rateExist['amount'] + data['Amount']
            rateExist['amount'] = Number(rateExist['amount'].toFixed(8))
            orderBooks = orderBooks.filter(e=> e['rate'] != data['Rate']) // eski datayı orderbookstan çıkarıyoruz güncel halini eklicez
            orderBooks.push(rateExist)
        }else{
            const typem = data['Type'] == 1 ? 'asks' : 'bids'
            orderBooks.push({'rate': data['Rate'], 'amount': data['Amount'], 'type': typem })
        }

        return orderBooks
    }

    OrderSil(data, orderBooks){
        if(orderBooks.length == 0) return orderBooks
        const onceLen = orderBooks.length
        //let rateExist = list(filter(lambda x: x['rate'] == data['Rate'],orderBooks))
        let rateExist = orderBooks.find(e=> e['rate'] == data['Rate'])
        if (!rateExist) return orderBooks

        const onceAmount = rateExist['amount']
        rateExist['amount'] = rateExist['amount'] - data['Amount']
        rateExist['amount'] = Number(rateExist['amount'].toFixed(8))
        if (rateExist['amount'] > 0){
            orderBooks = orderBooks.filter(e=> e['rate'] != data['Rate'])
            orderBooks.push(rateExist)
        }else{
            orderBooks = orderBooks.filter(e=> e['rate'] != data['Rate'])

            const sonraLen = orderBooks.length
            if (onceLen == sonraLen && onceAmount == data['Amount'])
                print('huhu')
        }

        return orderBooks
    }

    async CheckVariableExist(){
        const data = { key: 'ws-processing', value: false}
        const variables = await this.ortak.variables.findOne({key: data.key})
        if(!variables){
            await this.ortak.variables.insertOne(data)
        }
    }

    async UpdateProcessStatus(type){
        await this.CheckVariableExist()
        await this.ortak.variables.updateOne({key: 'ws-processing'}, {'$set': {'value': type}})
    }

    async WsBaslat(callback){
        // processi durdur.
        await this.UpdateProcessStatus(true) // ilk başladığında da update ediyoruz. aşağıda ws zamanlayıcıda olduğu gibi.

        this.WsZamanlayici(callback)
        if(this.ortak.wsDataProcessing && this.ortak.ws){
            console.log('###############################################################    WS ZATEN AÇIK   ############################################################### ')
            this.ortak.ws.close()
        }

        const fullUrl = 'https://www.cryptopia.co.nz/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&_=' + new Date().getTime()
        const result = await rp(fullUrl).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        const token = encodeURIComponent(result['ConnectionToken'])
        const wsUrl = 'wss://www.cryptopia.co.nz/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&tid=7&connectionToken=' + token
    
        this.ortak.ws = new WebSocket(wsUrl);
        this.ortak.ws.onmessage = (msg) => {
            var data = JSON.parse(msg.data)
            if(!data || !data.M || data.S || data.I || data.G) return

            for (const dataM of data['M']) {
                if (!dataM['M'] == 'SendTradeDataUpdate') continue
                const datam = dataM['A']
                //actions = list(filter(lambda x: 'Action' in x, list(datam)))
                const actions = datam.filter(e=> e['Action'] >= 0)
                if(actions.length == 0 ) continue 

                for (const action of actions) {
                    this.OrderBookInsert(action, callback)
                }
            }
        }

        this.ortak.ws.onerror = (err) => console.log(err)
        this.ortak.ws.onclose= () => console.log('WS KAPANDI')// bağlantı koptuğunda 2 saniye sonra birdaha bağlan
        this.ortak.ws.onopen = async () =>{
            console.log('WS Opened');
            await this.PrepareDbAndGetUygunMarkets()
            //this.ortak.depths = this.ortak.depths.filter(e=> [101].includes(e.tradePairId))
            const allDepthds = await this.ortak.depths.find().toArray()
            const leng = allDepthds.length
            for(var i=0; i < leng; i = i + 5){
                await this.DbOrderbookDoldurBesMarkets(allDepthds.slice(i, i + 5 ))// 5er 5er kayıt göndereecek
                this.subSayac = this.subSayac + 5
                console.log(this.subSayac + ' market eklendi. Tolam market: '+ leng)
            }
            this.UpdateProcessStatus(false) // process bitti diye update ediyoruz.
            console.log('OrderBooks atama işlemi bitti. Tarih: '+ new Date());            
        }
    }

    WsZamanlayici(callback){
        setTimeout(() => {
            this.UpdateProcessStatus(true)  // ws kapanmadan önce db yi process başladı diye update ediyoruz.
            this.ortak.ws.close()
            //this.ortak.depths = []
            this.subSayac = 0
            this.WsBaslat(callback)
        }, 1000 * 60 * this.wsZamanlayici) // salisel * saniye * dk
    }

    async DbOrderbookDoldurBesMarkets(besMarkets){
        const marketNames = []
        for (const i of besMarkets) {
            marketNames.push(i.market)
        }
        
        await this.ortak.ccx.exchange.fetchOrderBooks(marketNames)
        .then(besOrderBooks=>{
            for (const i in besOrderBooks) {
                const market = besOrderBooks[i]
                let bids = market.bids.map(e=> ({ rate:e[0], amount:e[1], type:'bids'}))
                bids = bids.slice(0, this.orderBookCount) // ilk 5 kayıt.
                let asks = market.asks.map(e=> ({ rate:e[0], amount:e[1], type:'asks'}))
                asks = asks.splice(0, this.orderBookCount) // ilk 5 kayıt
                const tradePairId = besMarkets.find(e=> e.market == i).tradePairId
                this.ortak.depths.updateOne({'tradePairId': tradePairId}, {'$set': {'depths': { bids, asks }}})
                //this.ortak.depths.find(e=> e.market == i).depths = { bids, asks}
                const orderBookMessage = '{"H":"notificationhub","M":"SetTradePairSubscription","A":[' + tradePairId + ',null],"I":0}'
                this.ortak.ws.send(orderBookMessage)
            }
        }).catch(async (e)=>{
            if(e.message.includes('per second')){
                await this.ortak.sleep(11)
            }
            console.log('DbOrderbookDoldurBesMarkets Hata verdi tekrar başlıcak. HATA: ',e)
            await this.DbOrderbookDoldurBesMarkets(besMarkets)
        })
        
    }
}

async function Basla(){
    var wsDepth = new WsDepth()
    await wsDepth.LoadVeriables()
    wsDepth.WsBaslat()
}

Basla()