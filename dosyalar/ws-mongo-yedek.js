const Ortak = require('./ortak')
const rp = require('request-promise')
const WebSocket = require('ws');

class CryBuy {
    async LoadVeriables() {
        this.islemKati = 15
        this.minFark = 1
        this.islemdekiCoinler = []
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
        setInterval(async ()=> await this.BalanceGuncelle(), 2000 )
        this.balances = []
        this.oncekiCoin = null
    }

    SteamHandler(coin){
        if(this.islemdekiCoinler.includes(coin) || this.ortak.mainMarkets.includes(coin)) return
        this.FiyatFarkKontrolYeni(coin, 'BTC', 'LTC', 'DOGE')
    }

    async FiyatFarkKontrolYeni(coin, fmc, smc, tmc){
        if(this.oncekiCoin == coin) return
        this.oncekiCoin = coin
        this.islemdekiCoinler.push(coin)
        //console.log(coin + ' Girdi', this.islemdekiCoinler.length)
        const promise1 = this.MarketHazirla(coin, fmc, smc,'ust', tmc, 'ust') // BTC, LTC, DOGE
        const promise2 = this.MarketHazirla(coin, smc, fmc,'alt', tmc, 'ust') // LTC, BTC, DOGE
        const promise3 = this.MarketHazirla(coin, tmc, fmc,'alt', smc, 'alt') // ETH, BTC, LTC

        Promise.all([promise1, promise2, promise3]).then(e => {
            this.islemdekiCoinler = this.islemdekiCoinler.filter(a =>  a != coin )
        }).catch(e=>{
            this.HataEkle(e)
            this.islemdekiCoinler = this.islemdekiCoinler.filter(a =>  a != coin )
        })

    }

    HataEkle(e){
        if(e.message != "Cannot read property 'rate' of undefined"){
            this.ortak.mailDataHata.insertOne(e.message)
        }
    }

    async MarketHazirla(coin, fmc, smc, smct, tmc, tmct){
        await this.MarketeGir(coin, fmc, smc, smct)
        await this.MarketeGir(coin, fmc, tmc, tmct)
    }

    async MarketeGir(coin, firstMainCoin, secondMainCoin, type){
        const thidrMarketName = type == 'alt' ? firstMainCoin  + '/' + secondMainCoin : secondMainCoin + '/' + firstMainCoin
        const thirdMainCoin = thidrMarketName.split('/')[1]

        const data = {'minFark': this.minFark,  
        'coin': coin,
        'firstMainCoin': firstMainCoin,
        'secondMainCoin': secondMainCoin,
        'thirdMainCoin': thirdMainCoin,
        'type': type,
        'firstMarketName': coin + '/' + firstMainCoin,
        'secondMarketName': coin + '/' + secondMainCoin,
        'thirdMarketName': thidrMarketName,
        'btcMarketName': coin + '/' + 'BTC'
        }

        await this.MarketKontrolveEkle(data)
    }

    async MarketKontrolveEkle(d){
        const rob = await this.GetOrderBookGroup(d) // result order book yani rob
        if(!rob || !rob['firstOrderBook'] || !rob['secondOrderBook'] || !rob['thirdOrderBook'])
            return 

        //rk yani result kontrol
        const rk = this.Kontrol(d, rob['firstOrderBook'][0]['Price'], rob['secondOrderBook'][0]['Price'], rob['thirdOrderBook'][0]['Price'])

        if(rk['sonuc']){
            await this.UygunMarketEkle(rk, d, rob)
        }
    }

    Kontrol(d, firstPrice, secondPrice, thirdPrice){
        const ourTotal = this.ortak.limits[d['firstMainCoin']]
        // 0.09480919
        const firstMarketAmount = ourTotal / Number(firstPrice) // first market amount' u aldık.
        if(!isFinite(firstMarketAmount)) // infinity ise çık
            return False
        // 1.4079164715
        const secondMarketTotal = firstMarketAmount * secondPrice // totalimizi aldık. second market total.
        const thirdMarketTotal = d['type'] == 'alt' ? secondMarketTotal / thirdPrice : secondMarketTotal * thirdPrice // alt ise böy, üst se çarp
        const kar = thirdMarketTotal - ourTotal // elde edilen doge ile 10.000 doge arasındaki farka bakıyor. kâr.
        const fark = kar / ourTotal * 100
        const sonuc = fark >= d['minFark']
        return {'kar': kar, 'fark': fark, 'thirdMarketTotal': thirdMarketTotal, 'sonuc': sonuc}
    }

    async UygunMarketEkle(rk, d, rob){
        const uygunMarket = {
            'id': this.GetId(),
            'fark': rk['fark'],
            'kar': rk['kar'],
            'firstMarket': { 
                'name': d['firstMarketName'], 
                'askPrice': rob['firstOrderBook'][0]['Price'], 
                'orderBook': rob['firstOrderBook']},
            'secondMarket': { 
                'name': d['secondMarketName'], 
                'bidPrice': rob['secondOrderBook'][0]['Price'], 
                'orderBook': rob['secondOrderBook']},
            'thirdMarket': { 
                'name': d['thirdMarketName'], 
                'askPrice': rob['thirdOrderBook'][0]['Price'], 
                'orderBook': rob['thirdOrderBook'], 
                'amount': rk['thirdMarketTotal'], 
                'type': d['type'] },
            'btcMarket': {
                    'askPrice': rob['btcOrderBook'][0]['Price'] }
            }

        const result = this.CheckTamUygun(d, rob)
        if(result){
            console.log('Buy Sell Başla')
            await this.BuySellBasla(uygunMarket)
        }else{
            //console.log(`${d.firstMarketName}  >  ${d.secondMarketName}  Fark : % ${rk.fark.toFixed(2)}`)
        }
            
    }

    async GetOrderBooks(marketler){
        let orderBooks = await this.ortak.depths.find( { 'market': { '$in': marketler } } ).toArray()
        orderBooks = orderBooks.map(e=> {
            e.depths.market = e.market
            return e.depths
        }) //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
        return orderBooks
    }


    async GetOrderBookGroup(d){
        const marketList = [ d['firstMarketName'], d['secondMarketName'], d['thirdMarketName'], d['btcMarketName']  ]
        const orderBooks = await this.GetOrderBooks(marketList)
        if(orderBooks.length < 3) return false

        let firstOrderBook = orderBooks.find(e=> e.market == d['firstMarketName'])
        let secondOrderBook = orderBooks.find(e=> e.market == d['secondMarketName'])
        let thirdOrderBook = orderBooks.find(e=> e.market == d['thirdMarketName'])
        let btcOrderBook = orderBooks.find(e=> e.market == d['btcMarketName'])
        
        if(!firstOrderBook || !secondOrderBook || !thirdOrderBook || !btcOrderBook) return false
            
        if(firstOrderBook['asks'][0]['rate'] == 0.00000001 || secondOrderBook['asks'][0]['rate'] == 0.00000001 || thirdOrderBook['asks'][0]['rate'] == 0.00000001) return false
        
        if(btcOrderBook['asks'][0]['rate'] == 0.00000001 || btcOrderBook['bids'][0]['rate'] < 0.00000022) return false// btc kontrol

        firstOrderBook = [{"Price": Number(firstOrderBook['asks'][0]['rate']),"Total": Number(firstOrderBook['asks'][0]['rate']) * Number(firstOrderBook['asks'][0]['amount'])}]
        secondOrderBook = [{"Price": Number(secondOrderBook['bids'][0]['rate']),"Total": Number(secondOrderBook['bids'][0]['rate']) * Number(secondOrderBook['bids'][0]['amount'])}]
        btcOrderBook = [{"Price": Number(btcOrderBook['asks'][0]['rate']),"Total": Number(btcOrderBook['asks'][0]['rate']) * Number(btcOrderBook['asks'][0]['amount'])}]

        if(d['type'] == 'alt'){
            thirdOrderBook = [{"Price": Number(thirdOrderBook['asks'][0]['rate']),"Total": Number(thirdOrderBook['asks'][0]['rate']) * Number(thirdOrderBook['asks'][0]['amount'])}]
        }else{
            thirdOrderBook = [{"Price": Number(thirdOrderBook['bids'][0]['rate']),"Total": Number(thirdOrderBook['bids'][0]['rate']) * Number(thirdOrderBook['bids'][0]['amount'])}]
        }

        return {'firstOrderBook': firstOrderBook, 'secondOrderBook': secondOrderBook, 'thirdOrderBook': thirdOrderBook, 'btcOrderBook': btcOrderBook}
    }

    CheckTamUygun(d, rob){
        const firstTotal = rob['firstOrderBook'][0]['Total']
        const firstLimit = this.ortak.limits[d['firstMainCoin']]
        const secondTotal = rob['secondOrderBook'][0]['Total'] 
        const secondLimit = this.ortak.limits[d['secondMainCoin']]

        const result = firstTotal >= firstLimit && secondTotal >= secondLimit // rob['firstOrderBook'][0]['Total']  >= this.ortak.limits[d['firstMainCoin']]
        return result
    }

    GetId() {
        return '_' + Math.random().toString(36).substr(2, 9);
    }

    async BuySellBasla(market){
        const btcMarket = market['btcMarket']
        const firstMarket = market['firstMarket']
        const secondMarket = market['secondMarket']

        const altCoin = firstMarket['name'].split('/')[0]

        const balanceVar = await this.BalanceKontrol(btcMarket['askPrice'], altCoin)
        if(balanceVar){
            console.log('Yeterince balance var. ÇIK', altCoin)
            return
        }
        let baseCoin = ''
        let amount = 0
        let total = 0
        let price = 0
        let firstAmount = firstMarket['orderBook'][0]['Total'] / firstMarket['orderBook'][0]['Price'] // tofixed yerine round
        let secondAmount = secondMarket['orderBook'][0]['Total'] / secondMarket['orderBook'][0]['Price'] // tofixed yerine round
        firstAmount = Number(firstAmount.toFixed(8))
        secondAmount = Number(secondAmount.toFixed(8))
        const firstMarketName = firstMarket['name']

        if(firstMarket['name'] == 'LUX/BTC'){
            var dur = true
        }

        if(firstAmount < secondAmount){
            amount = firstAmount
            total = firstMarket['orderBook'][0]['Total']
            price = firstMarket['orderBook'][0]['Price']
            baseCoin = firstMarket['name'].split('/')[1]
        }else{
            amount = secondAmount
            total = secondMarket['orderBook'][0]['Total']
            price = secondMarket['orderBook'][0]['Price']
            baseCoin = secondMarket['name'].split('/')[1]
        }

        total = Number(total.toFixed(8))
        
        if(total < this.ortak.limits[baseCoin]){
            console.log('Alınacak total yeterli değil');
            return // total lititten küçükse dön
        } 

        const barajTotal = this.ortak.limits[baseCoin] * this.islemKati

        if(total > barajTotal){
            amount = barajTotal / price
            amount = Number(amount.toFixed(8))
        }
                    

        const buyResult = await this.Submit(market, firstMarketName, firstMarket['orderBook'][0]['Price'], amount, 'buy')
        if(buyResult){
            let buyIptalResult, sellResult, sellIptalResult

            if(buyResult['filled'] && buyResult['filled'] > 0){
                sellResult = await this.Submit(market, secondMarket['name'], secondMarket['orderBook'][0]['Price'], buyResult['filled'], 'sell')
                if(sellResult && sellResult['filled'] < buyResult['filled'])
                    sellIptalResult = await this.OrderIptalEt(sellResult)
                    const kalanAmount = buyResult['filled'] - sellResult['filled']
                    await this.HistoryEkle(altCoin, kalanAmount, btcMarket['askPrice'])
            }

            if(!buyResult['filled'] || buyResult['filled'] < amount){
                buyIptalResult = await this.OrderIptalEt(buyResult)
            }
            
            if(buyResult['filled'] == 0){
                const mailDatam = {'firstMarket': firstMarketName,
                'secondMarket': secondMarket['name'],
                'uygunMarket': market,
                'Hata': 'BUY ALMAYA YETİŞEMEDİ',
                'date': new Date()}
                await this.ortak.mailDataBosBuy.insertOne(mailDatam)
                return
            }  // buyresult 0 ise iptal edilmiş zaten boşuna maildata ekleme

            //Object.keys(buyResult).filter(key => !buyResult[key] && delete buyResult[key])
            const mailDatam = {'firstMarket': firstMarketName,
                        'secondMarket': secondMarket['name'],
                        'uygunMarket': market,
                        'buyAmount': amount,
                        'sellAmount': buyResult['filled'] ? buyResult['filled'] : 0,
                        'buyResult': buyResult,
                        'sellResult': sellResult,
                        'sellIptalResult': sellIptalResult,
                        'buyIptalResult': buyIptalResult,
                        'date': new Date()}
                        
            //this.ortak.db.ref('okex/sell-buy-trade-mailData').push(mailDatam)
            await this.ortak.mailData.insertOne(mailDatam)
            console.log('##############################     BİR İŞLEM OLDU     ##############################')
        }
    }

    async Submit(market, marketName, rate, amount, type){
        const orderParams = [marketName, 'limit', type, amount, rate]
        
        const submitOrder = await this.ortak.ccx.exchange.createOrder(...orderParams).catch(e => {
            market['Hata'] = e.message
            market['date'] = new Date()
            this.ortak.mailDataHata.insertOne(market)
            console.log(e, orderParams)
        })

        if (submitOrder) {
            console.log(`${marketName} için  ${type} kuruldu.'`)
            return submitOrder
        } else {
            console.log(`${type} Kurarken Hata. market: ${marketName}`)
            return false
        }
    }

    async OrderIptalEt(order) {
        return await this.ortak.ccx.CancelTrade(order.id, order.symbol).catch(e => console.log(e))
    }

    async BalanceGuncelle(){
        const balances = await this.ortak.GetBalance().catch(e=> this.HataEkle(e))
        if(balances){
            this.balances = balances
        }
    }

    async BalanceKontrol(anaCoinPrice, altCoin){
        //const balances = await this.ortak.GetBalance()
        let altCoinTotal = this.balances.find(e=> e.Symbol == altCoin).Total //balances[altCoin]['total']
        const altCoinBtcDegeri = altCoinTotal * anaCoinPrice
        return altCoinBtcDegeri > this.ortak.limits['BTC']
    }

    async HistoryEkle(altCoin, amount, btcAskPrice ){
        await this.ortak.history.deleteMany({'coin': altCoin})
        await this.ortak.history.insertOne({'coin': altCoin, 'amount': amount, 'btcPrice': btcAskPrice, 'date': new Date() })
    }
    
    async PrepareDbAndGetUygunMarkets(){
        let allTickers = await this.ortak.ccx.GetMarkets().catch(e=> this.HataEkle(e))
        allTickers = allTickers.Data
        const  allMarkets = allTickers.map(e=> e.Label)
        const mainMarkets = ['LTC/BTC', 'DOGE/LTC', 'DOGE/BTC']

        const umFilter = allTickers.filter(x=>{
            const coin = x.Label.split('/')[0]
            const markets = [coin + '/BTC', coin + '/LTC', coin + '/DOGE']
            if(mainMarkets.includes(x.Label)) return false
            const butunMarketlerdeVar = allMarkets.includes(markets[0]) && allMarkets.includes(markets[1]) && allMarkets.includes(markets[2]) && x.Volume > 0.1
            return butunMarketlerdeVar
        })
        return umFilter
    }

    async OrderBookInsert(data, uygunMarkets){
        const depths = await this.ortak.depths.findOne({ 'tradePairId': data['TradePairId'] })
        if(!depths) return
        //console.log(depths.market +" "+ data['Action'])

        let bids = []
        let asks = []
        
        if(depths['depths']['bids'].length > 0)
            bids = depths['depths']['bids']

        if(depths['depths']['asks'].length > 0)
            asks = depths['depths']['asks']

        const mix = bids.concat(asks)
        let yeniMix
        if(data['Action'] == 0) // add
            yeniMix = this.OrderEkle(data, mix)
        
        if(data['Action'] == 3) // sil (iptal)
            yeniMix = this.OrderSil(data, mix)

        if(data['Action'] == 1) // sil (işlem yapıldı buy yada sell)
            yeniMix = this.OrderSil(data, mix)


        //asks = list(filter(lambda x: x['type'] == 'asks', mix))
        asks = yeniMix.filter(e=> e['type'] == 'asks')
        asks.sort((a,b)=> a.rate - b.rate)
        //asks.sort()
        //asks = sorted(asks, key=lambda x: x['rate'])

        //bids = list(filter(lambda x: x['type'] == 'bids', mix))
        bids = yeniMix.filter(e=> e['type'] == 'bids')
        bids.sort((a,b)=> b.rate - a.rate)
        //bids = sorted(bids, key=lambda x: x['rate'],  reverse=True)

        if(data['Action'] == 0){// #and steamBasla:
            //ratem = list(filter(lambda x: x['rate'] == data['Rate'], mix ))
            const ratem = yeniMix.find(e=> e['rate'] == data['Rate'])
            if(!ratem) return

            let indexim = -1
            if(data['Type'] == 1){// # sell 
                indexim = asks.findIndex(e=> e['rate'] == data['Rate'])
                //indexim = asks.map(e=>e['rate']).indexOf [x['rate'] for x in asks].index(data['Rate'])
            }else{
                indexim = bids.findIndex(e=> e['rate'] == data['Rate'])
            }

            if(indexim == 0){
                const uygunMarket = uygunMarkets.find(e=> e['TradePairId'] == data['TradePairId'])
                const coin = uygunMarket.Label.split('/')[0]
                this.SteamHandler(coin)
            }
        }
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

    async WsBaslat(){
        const uygunMarkets = await this.PrepareDbAndGetUygunMarkets()
        const fullUrl = 'https://www.cryptopia.co.nz/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&_=' + new Date().getTime()
        const result = await rp(fullUrl).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        const token = encodeURIComponent(result['ConnectionToken'])
        const wsUrl = 'wss://www.cryptopia.co.nz/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&tid=7&connectionToken=' + token
    
        var wsApi = new WebSocket(wsUrl);
        wsApi.onmessage = (msg) => {
            var data = JSON.parse(msg.data)
            if(!data || !data.M || data.S || data.I || data.G) return

            for (const dataM of data['M']) {
                if (!dataM['M'] == 'SendTradeDataUpdate') continue
                const datam = dataM['A']
                //actions = list(filter(lambda x: 'Action' in x, list(datam)))
                const actions = datam.filter(e=> e['Action'] >= 0)
                if(actions.length == 0 ) continue 

                for (const action of actions) {
                    this.OrderBookInsert(action, uygunMarkets)
                }
            }
        }

        wsApi.onerror = (err) =>{
            console.log(err);
        }

        wsApi.onclose= () => {
            setTimeout(() => { this.WsBaslat() }, 5000); // bağlantı koptuğunda 2 saniye sonra birdaha bağlan
        }
    
        wsApi.onopen = () =>{
            for (const i of uygunMarkets) {
                const orderBookMessage = '{"H":"notificationhub","M":"SetTradePairSubscription","A":[' + i.TradePairId + ',null],"I":0}'
                wsApi.send(orderBookMessage)
            }
        }
    }
}

async function Basla(){
    var cryBuy = new CryBuy()
    await cryBuy.LoadVeriables()
    //await cryBuy.ortak.sleep(60*2)
    cryBuy.WsBaslat()
}

Basla()
