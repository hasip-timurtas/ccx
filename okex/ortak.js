const mongodb = require('mongodb')
const rp = require('request-promise')
const MhtCcxt = require('../dll/mhtCcxt')
const firebase = require('firebase-admin')
const serviceAccount = require("../dll/firebase.json")
firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://firem-b3432.firebaseio.com"
})

const mongoUrl = "mongodb://202.182.123.217:1453/";

class Ortak {
    async LoadVeriables(type){
        if(!type) throw 'LÜTFEN ORTAK CLASS İÇİN TYPE GİRİN.'
        this.type = type
        this.minFark = 2
        this.mainMarkets = ['USDT', 'BTC', 'ETH']
        this.site = 'okex'
        const key = "cc624bb0-e2e2-400e-91e8-60b1444d9037" // hasip okex
        const secret = "29B4A74AF2EFA4CE5CF38DA6EAAC0436"
        /*
        const key = "f4544544-67bd-4984-b26e-642a4951dedf" // apo okex
        const secret = "D90A009CB124702AF2FD382747909628"
        */
        this.ccx = new MhtCcxt(key, secret, this.site, null)
        this.limits = { "BTC": 0.0006, "ETH": 0.011, "LTC": 0.08, "DOGE": 1100, "BNB":5.1, "USD": 3, "USDT": 2.5 }
        this.sellLimits = { "BTC": 0.0006, "ETH": 0.021, "LTC": 0.08, "DOGE": 1100, "BNB":5.1, "USD": 3, "USDT": 2.5 }
        this.volumeLimtis = { "BTC": 0.5, "ETH": 10, "LTC": 50, "DOGE": 1100, "BNB":250, "USD":3250, "USDT":3250 }
        this.db = firebase.database()
        const connection = await mongodb.MongoClient.connect(mongoUrl, { useNewUrlParser: true });
        const cnn = connection.db('okex')
        this.wsDataProcessing = true // ilk başta true diyoruz. ilk çalıştığında beklesin diye.
        if(type == 'MONGO'){
            this.wsDataProcessing = false // boşuna beklemesinler çünkü ws yok.
            this.depths = cnn.collection('ws-depths')
        }else if(type == 'RAM'){
            this.depths = []
            const WsDepth = require('./ws-depth-ram')
            this.wsDepth = new WsDepth()
            await this.wsDepth.LoadVeriables(this)
        }
        this.fbBalances = cnn.collection('balances')
        this.history = cnn.collection('history')
        this.mailData = cnn.collection('mailData')
        this.mailDataMinMax = cnn.collection('mailData-min-max')
        this.mailDataEski = cnn.collection('mailData-Eski')
        this.mailDataBosBuy = cnn.collection('mailData-bos-buy')
        this.mailDataHata = cnn.collection('mailData-hata')
        this.openOrders = cnn.collection('openOrders')
        this.testler = cnn.collection('testler')
        this.variables = cnn.collection('variables')
        this.marketsInfos = await this.ccx.exchange.load_markets().catch(e=> console.log(e) )
        this.marketsInfos = this.marketsInfos && Object.keys(this.marketsInfos).map(e=> this.marketsInfos[e])
        this.marketTickers = await this.ccx.GetMarkets().catch(e=> console.log(e))
        this.islemdekiCoinler = []
        this.allData = []
        this.allActiveCoins = []//this.marketsInfos && this.marketsInfos.filter(e=> e.active &&  e.quote == 'BTC').map(e=>e.baseId.toUpperCase()).filter(e=> !this.mainMarkets.includes(e))
        this.testAmount = 100
        this.ws
        this.wsZamanlayici = 30 // DAKİKA
    }

    async GetVariable(key){
       return await this.variables.findOne({key})
    }

    SetVariable(key, value){
        this.variables.updateOne({key}, {'$set': {value}}, {upsert: true})
     }

    InsertTestler(data){
        this.testler.insertOne(data)
    }

    WatchAllCollection(collection){
        collection.watch().on('change', data => {
            callback(data)
        });
    }

    async SubmitSellKontrol(marketName, rate, amount, type){
        const orderParams = [marketName, 'limit', type, amount, rate]
        if(marketName.includes('SHOW')){
            var dur = 1
        }
        const openOrderVar = await this.OpenOrderVarMi(marketName, type)
        if(openOrderVar){
            console.log(marketName + ' open order zaten var!')
            return false
        }

        const submitOrder = await this.ccx.exchange.createOrder(...orderParams).then(e=>{
            return e
        }).catch(e => {
            console.log(e, marketName)
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
        return await this.ccx.CancelTrade(order.id, order.symbol).catch(e => console.log(e))
    }

    async OpenOrderVarMi(marketName, type){
        let openOrders = await this.ccx.GetOpenOrders(marketName)
        openOrders = openOrders.Data
        // const openOrders = await this.openOrders.find().toArray()
        if(openOrders.length == 0){  // hiç order yoksa mongo db dekileri siler ve false dönder.
            await this.DeleteOrderFb(marketName, type)
            return false
        } 
        const order = openOrders.find(e=> e.Market.includes(marketName) && e.Type == type )
        return order || false 
    }



    async DahaIyiMarketVarmi(openOrder, type){ // type sell yada buy sell de en hapalı buy da en ucuz market aranır.
        const altCoin = openOrder.market.split('/')[0]
        let market
        if(type == 'sell'){
            market = await this.HangiMarketteEnPahali(altCoin)
        }else if(type == 'buy'){
            market = await this.HangiMarketteEnUcuz(altCoin)
        }

        if(!market) return false
        return market.market != openOrder.market
    }

    async HangiMarketteEnUcuz(coin){
        // marketler sırayla --> ADA/USDT, ADA/BTC, ADA/ETH ve BTC/USDT, ETH/USDT
        const { market1, market2, market3, market4, market5 } = await this.GetAltiMarketTickers(coin)
        
        if(!market1) return false // eğer 1 market bile yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.

        const coinMarket2Total = this.GetMarketTotal(market2, 'buy')  // ADA/BTC
        const coinMarket3Total = this.GetMarketTotal(market3, 'buy')  // ADA/ETH
        

        market1.total = this.GetMarketTotal(market1, 'buy')  // ADA/USDT  değeri  -> bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        market2.total = market4.bids[0]['rate'] * coinMarket2Total // BTC/USDT  değeri
        market3.total = market5.bids[0]['rate'] * coinMarket3Total  // ETH/USDT  değeri

        const markets = [market1, market2, market3].sort((a,b)=> a.total - b.total) // a-b küçükten büğüğe
        return markets[0] || false // sıraya dizdikten sonra ilk en KÜÇÜK marketi döndürüyoruz.
    }

    async GetAltiMarketTickers(coin){
        // mainMarkets -> ['BTC', 'LTC', 'DOGE']
        const marketler = [
            coin + "/" + this.mainMarkets[0], // ADA/BTC
            coin + "/" + this.mainMarkets[1], // ADA/LTC
            coin + "/" + this.mainMarkets[2], // ADA/DOGE
            this.mainMarkets[1] + "/" + this.mainMarkets[0], // LTC/BTC
            this.mainMarkets[2] + "/" + this.mainMarkets[0], // DOGE/BTC
            this.mainMarkets[2] + "/" + this.mainMarkets[1]  // DOGE/LTC
        ]

        let orderBooks = await this.GetOrderBooks(marketler)
        const result = this.OrderBooksDataKontrol(orderBooks)
        
        if(!result || orderBooks.length < 6){
            return false
            //orderBooks = await this.GetOrderBookGroupRest(coin)
        }

        if(!orderBooks) return false
        
        //coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc
        return { 
            coinBtc : orderBooks.find(e => e.market == marketler[0]),
            coinLtc : orderBooks.find(e => e.market == marketler[1]),
            coinDoge: orderBooks.find(e => e.market == marketler[2]),
            ltcBtc  : orderBooks.find(e => e.market == marketler[3]),
            dogeBtc : orderBooks.find(e => e.market == marketler[4]),
            dogeLtc : orderBooks.find(e => e.market == marketler[5])
        }
    }

    GetAltiMarketTickersBuySell(coin){
        // mainMarkets -> ['BTC', 'LTC', 'DOGE']
        const marketler = [
            coin + "/" + this.mainMarkets[0], // ADA/BTC
            coin + "/" + this.mainMarkets[1], // ADA/LTC
            coin + "/" + this.mainMarkets[2], // ADA/DOGE
            this.mainMarkets[1] + "/" + this.mainMarkets[0], // LTC/BTC
            this.mainMarkets[2] + "/" + this.mainMarkets[0], // DOGE/BTC
            this.mainMarkets[2] + "/" + this.mainMarkets[1]  // DOGE/LTC
        ]

        return { 
            coinBtc : this.findMarket(marketler[0]),
            coinLtc : this.findMarket(marketler[1]),
            coinDoge: this.findMarket(marketler[2]),
            ltcBtc  : this.findMarket(marketler[3]),
            dogeBtc : this.findMarket(marketler[4]),
            dogeLtc : this.findMarket(marketler[5])
        }
    }

    async GetOrderBooks(marketler, all = false){
        let orderBooks
        if(all) { // all true ise hepsini döndürür.
            orderBooks = await this.GetDepths('all')
        }else{
            orderBooks = await this.GetDepths('list', marketler)
        }
        
        orderBooks = orderBooks.map(e=> {
            if(!e.depths){
                return e
            }
            e.depths.market = e.market
            return e.depths
        }) //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
        
        return orderBooks
    }

    async GetDepths(type, data){
        switch (type) {
            case 'all':
                if(this.type == 'MONGO'){
                    return await this.depths.find().toArray()
                }else{
                    return this.depths
                }
            case 'list':
                if(this.type == 'MONGO'){
                    return await this.depths.find( { 'market': { '$in': data } } ).toArray()
                }else{
                    return this.depths.filter(e=> data.includes(e.market))
                }
            case 'single':
                if(this.type == 'MONGO'){
                    return await this.depths.findOne({ market: data } )
                }else{
                    return this.depths[data]
                }
        }
    }

    SetPrices(marketName){

        const basamak = this.marketsInfos.find(e=> e.id.toLowerCase() == marketName.replace('/','_').toLowerCase()).precision.price
        switch (basamak) {
            case 1: return 0.1
            case 2: return 0.01
            case 3: return 0.001
            case 4: return 0.0001
            case 5: return 0.00001
            case 6: return 0.000001
            case 7: return 0.0000001
            case 8: return 0.00000001
            case 9: return 0.000000001
            case 10: return 0.0000000001
        }
    }

    GetKacinci(marketOrders, openOrder, type) {
        var result = { sellSirasi: 0, ilkSellTutar: 0, ikinciSellPrice: 0}

        var secilenSellPrice = marketOrders[type].find(e => Number(e['rate']) == openOrder.price)
        result.sellSirasi = secilenSellPrice && marketOrders[type].indexOf(secilenSellPrice) + 1
        result.ikinciSellPrice = Number(marketOrders[type][1]['rate']) // ikinci sıradakinin buy price.. [1][1] olsaydı 2. sıradakinin amountu olurdu.
        result.ilkSellTutar = marketOrders[type][0]['amount']
        result.ilkSellTutar = Number(result.ilkSellTutar)

        return result
    }

    OndekiTutarKontrolu(sira, marketOrders, type){
        var ilkinTutari = marketOrders[type][0]['rate'] * marketOrders[type][0]['amount']  // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkVeIkincininTutari = ilkinTutari + marketOrders[type][1]['rate'] * marketOrders[type][1]['amount'] // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkIkiVeUcuncununTutari = ilkVeIkincininTutari + marketOrders[type][2]['rate'] * marketOrders[type][2]['amount']
        
        if(sira == 1){

        } else if (sira == 2 && ilkinTutari < this.bizimTutarin3te1i) {
            // 2. sıradaysa ve ilk orderin tutarı bizimkinin 3te1inden düşükse kalsın. bu ilerde %5 te olabilir.
        } else if (sira == 3 && ilkVeIkincininTutari < this.bizimTutarin3te1i) {
            // 3. sıradaysa ve ilkin ve ikincinin tutarı bizimkinin 3te1inden düşükse kalsın. bu ilerde %5 te olabilir.
        } else if (sira == 4 && ilkIkiVeUcuncununTutari < this.bizimTutarin3te1i) {
            // 4. sıradaysa ve ilkin ve ikincinin ve ucuncunun tutarı bizimkinin 3te1inden düşükse kalsın. bu ilerde %5 te olabilir.
        } else {
            //await this.CancelOrder(orderId)
            return true
        }

        return false
    }
    
    async GetBalance(){
        let balances = await this.ccx.GetBalance().catch(e => console.log(e))

        if(!balances || !balances.Data){
            return await this.GetBalance()
        }
        balances = balances.Data
        const isimleriFarkliCoinler = this.marketsInfos.filter(e=> e.baseId != e.base).map(e=> ({base: e.base, baseId: e.baseId}))
        balances.filter(e=> {
            if(isimleriFarkliCoinler.map(e=> e.base).includes(e.Symbol)){
                const coin = isimleriFarkliCoinler.find(a=> a.base == e.Symbol)
                e.Symbol = coin.baseId
            }
            e.Symbol= e.Symbol.toUpperCase()
        })

        return balances.sort((a,b)=> a.Symbol - b.Symbol)
    }

    async fbBalancesUpdate(totalBalances){
        await this.fbBalances.deleteMany({})
        this.fbBalances.insertMany(totalBalances)
    }

    async GetTickers(marketler){
        let tickers = await this.GetDepths('list', marketler)
        tickers = tickers.map(e=> {
            e.ticker.market = e.market
            return e.ticker
        }) //  içinde market ismi olan tickeri gönderiyoruz. orjinalinde yok.
        return tickers
    }

    async GetOrderBook(marketName){
        let marketOrders = await this.GetDepths('single', marketName)
        if(!marketOrders){
            return false
        }
        marketOrders = marketOrders.depths
        marketOrders.market = marketName
        const result = this.OrderBooksDataKontrol([marketOrders])

        if(!result){
            return false
            //return await this.GetOrderBooksRest(marketName) 
        }
        
        return marketOrders
    }

    async GetHistory(coin){
        let marketHistory = await this.history.find({ coin } ).toArray()
        const history = marketHistory.sort((a,b)=> b.date - a.date) // en son history kaydını alıyoruz.

        return history[0] // son eklenen historiyi verir. güncel data.
    }

    sleep (saniye) {
		return new Promise(resolve => setTimeout(resolve, saniye * 1000))
    }

    // ################ MIN MAX BUY! ####################################################################################### MIN MAX

    async MinMaxBuyKontrol(marketName){
        const altCoin = marketName.split('/')[0]
        const baseCoin = marketName.split('/')[1]
        const marketNames = [altCoin + '/USDT', altCoin + '/BTC', altCoin + '/ETH' ]
        const coinTickers = await this.GetTickers(marketNames)

        // buy open ordersta var mı ? // normalde submitte var ama burdada kontrol ediyoruz fazla istek olmasın diye.
        const openOrderVar = await this.OpenOrderVarMi(marketName, 'buy')
        if(openOrderVar){
            console.log(marketName + ' open order zaten var!')
            return false
        }

        // VOLUME ŞİMDİLİK KALDIRILDI AMA EKLENMELİ. 2. marketin volume si de önemli çünkü!!!
        
        let volumeUygunCount = 0
        for (const ticker of coinTickers) {
            //if(ticker.vol == 0) return // marketlerin birinde bile volume 0 varsa çıkgit.
            const baseCoin2 = ticker.market.split('/')[1]
            const volume = ticker.buy * ticker.vol
            
            if(volume >= this.volumeLimtis[baseCoin2]){
                volumeUygunCount++
            }
        }

        if(volumeUygunCount < 3) { // Bütün marketlerin volumeleri bizim limitlerin altındaysa bu coine girme!
            console.log('Minimum 3 market Volumeleri yeterli değil. ÇIK: ', marketName)
            return
        }

        // alt coin için yeterince balance var mı ?
        const balances = await this.GetBalance()
        const altCoinBalance = balances.find(e=> e.Symbol == altCoin).Total
        const marketTicker = coinTickers.find(e=> e.market == marketName)
        const total = marketTicker.sell * altCoinBalance

        if(total >= this.limits[baseCoin] ){
            console.log('elde yeterince coin var. ÇIK: ', marketName)
            return
        }
  
        const ondalikliSayi = this.SetPrices(marketName)
        const buyPrice = Number(marketTicker.buy) + ondalikliSayi
        const alinacakBalance = this.limits[baseCoin] * 15 / marketTicker.buy // total 10 * limit 
        // Şartlara uyuyorsa buy yap.
        await this.Submit(marketName, buyPrice, alinacakBalance, 'buy').then(async (e)=>{
            if(!e.id) return
            await this.InsertOrderFb(e, 'buy')
        }).catch(e=>{
            console.log(e, balance.Symbol)
        })
    }

    async MinMaxKontrol(coin){
        this.islemdekiCoinler.push(coin)
        if(coin == 'HOT'){
            var dur = 1
        }
        //console.log(coin + ' GİRDİ', this.islemdekiCoinler)
        const enUcuzMarket = await this.HangiMarketteEnUcuz(coin)
        const enPahaliMarket = await this.HangiMarketteEnPahali(coin)
        if(!enUcuzMarket || !enPahaliMarket) return
        const yuzdeFark = (enPahaliMarket.total - enUcuzMarket.total) / enUcuzMarket.total * 100
        const ayniMarket = enUcuzMarket.market == enPahaliMarket.market
        if(isNaN(yuzdeFark)){
            var dur = 1
        }
        if(!ayniMarket && yuzdeFark >= 10 ){ // aynı market değilse ve fark %10 dan büyükse girsin.
            console.log('Buy için giriliyor yüzde fark: '+ yuzdeFark)
            await this.MinMaxBuyKontrol(enUcuzMarket.market)
        } 
        /*
        else if(ayniMarket && yuzdeFark >= 25){ // aynı marketse ve yüzde farkı 30 dan büyükse girsin.
            await this.MinMaxBuyKontrol(enUcuzMarket.market)
        }else{
            console.log('yüzde uymadı yüzde: ', yuzdeFark)
        }
        */
        this.islemdekiCoinler = this.islemdekiCoinler.filter(e=> e != coin)
        //console.log(coin + ' ÇIKTI', this.islemdekiCoinler)
    }

    async DeleteOrderFb(market, type){
        //await this.openOrders.deleteOne({market, side: type})
        
        const marketNameFb = market.replace('/','-')
        await this.db.ref('okex/open-orders').child(marketNameFb).set(null)
        await this.UpdateOpenOrderCount()
    }

    async InsertOrderFb(order, type){
        
        const total = order.price * order.amount
        const data = {
            orderId: order.id,
            market: order.symbol,
            price: Number(order.price.toFixed(8)),
            amount: Number(order.amount.toFixed(8)),
            total: total.toFixed(8),
            side: order.side
        }
        const marketNameFb = order.symbol.replace('/','-')

        await this.db.ref('okex/open-orders').child(marketNameFb).set(data)
        await this.UpdateOpenOrderCount()
        //await this.openOrders.insertOne(data)


        /*
        const marketNameFb = order.symbol.replace('/','_') + '-' +  order.id
        await this.db.ref(`cry/${type}-open-orders`).child(marketNameFb).set({
            orderId: order.id,
            market: order.symbol,
            price: order.price,
            amount: order.amount,
            total: total
        });
        */
        
    }

    async GetOpenOrders(){
        //return await this.openOrders.find().toArray()
        const fbOpenOrders = await this.db.ref('okex/open-orders').once('value').then(e => e.val())
        if(!fbOpenOrders) return []
        const openOrders = Object.keys(fbOpenOrders).map(e=> fbOpenOrders[e])
        await this.UpdateOpenOrderCount()
        return openOrders
    }

    async UpdateOpenOrderCount(){
        const size = await this.db.ref('okex/open-orders').once('value').then(e => e.numChildren())
        await this.db.ref('okex/open-orders-count').set(size)
    }
    
    async GetOrderBookGroupRest(coin){
        const marketler1 = [
            coin + "/" + this.mainMarkets[0], // ADA/BTC
            coin + "/" + this.mainMarkets[1], // ADA/LTC
            coin + "/" + this.mainMarkets[2]  // ADA/DOGE
        ]

        const marketler2 =[
            this.mainMarkets[1] + "/" + this.mainMarkets[0], // LTC/BTC
            this.mainMarkets[2] + "/" + this.mainMarkets[0], // DOGE/BTC
            this.mainMarkets[2] + "/" + this.mainMarkets[1]  // DOGE/LTC
        ]

        const marketler1String = marketler1.map(e=> e.replace('/','_')).join('-')
        const marketler2String = marketler2.map(e=> e.replace('/','_')).join('-')

        const fullUrl1 = `https://www.cryptopia.co.nz/api/GetMarketOrderGroups/${marketler1String}/5`
        const fullUrl2 = `https://www.cryptopia.co.nz/api/GetMarketOrderGroups/${marketler2String}/5`
        const result1 = await rp(fullUrl1).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        const result2 = await rp(fullUrl2).then(e=> JSON.parse(e)).catch(e=> console.log(e))

        if(!result1 || !result2 || !result1.Data || !result2.Data) return await this.GetOrderBookGroupRest(coin);
        if(result1.Data.length < 3 || result2.Data.length < 3) return false

        const marketler = marketler1.concat(marketler2)
        const result = result1.Data.concat(result2.Data)

        let uygunFormat = marketler.map(e=> {
            var market = result.find(x => x.Market == e.replace('/','_')) //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
            return { 
                bids: market.Buy ? market.Buy.map(a=> ({ rate: a.Price, amount: a.Volume})) : [], 
                asks: market.Sell.map(a=> ({ rate: a.Price, amount: a.Volume})),
                market: e
            }
        })

       return uygunFormat   
    }

    async GetOrderBooksRest(marketName){
        const market = await this.MarketOrderPost(marketName)
        var data =  { 
            bids: market.Buy.map(a=> ({ rate: a.Price, amount: a.Volume})), 
            asks: market.Sell.map(a=> ({ rate: a.Price, amount: a.Volume})),
            market: marketName
        }
        return data  
    }

    async MarketOrderPost(marketName){
        const fullUrl = `https://www.cryptopia.co.nz/api/GetMarketOrders/${marketName.replace('/','_')}/5`
        const result = await rp(fullUrl).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(!result || !result.Data) return await this.MarketOrderPost(marketName)
        return result.Data
    }
    
    async HangiMarketteEnPahaliBuy(coin){ // Buy için en pahalı market
        let history = await this.GetHistory(coin) // coinin en son alındığı fiyatı verir.
        if(!history) return false // history yoksa direk false döndür.
        const altiTickers = await this.GetAltiMarketTickers(coin)
        if(!altiTickers) return false
        const depthsKontrol = Object.keys(altiTickers).filter(e=> !altiTickers[e] || !altiTickers[e].asks || !altiTickers[e].bids) // boş item sayısı 0 dan büyükse false

        if(depthsKontrol.length > 0) return false // eğer 1 market bile yoksa ve depthleri yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.
        return this.FindIyiMarketiBuy(altiTickers, history)
    }
    

    FindIyiMarketiBuy(altiTickers, history){ // coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc
        const {coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc} = altiTickers
        // marketler sırayla --> ADA/BTC, ADA/LTC, ADA/DOGE ve LTC/BTC, DOGE/BTC, DOGE/LTC
        const totalBtc = this.GetMarketTotal(coinBtc, 'buy') // ADA/BTC  ->  bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        const totalLtc = this.GetMarketTotal(coinLtc, 'buy') // ADA/LTC  ->  1000 ada x LTC yapar değeri. LTC değer
        const toalDoge = this.GetMarketTotal(coinDoge, 'buy') // ADA/DOGE ->  1000 ada x Doge yapar değeri. DOGE değer  ### BUY çünkü doge de sell e bakarsak hepsinde doge çıkar.

        const ltcBtcTotal = ltcBtc.bids[0]['rate'] * totalLtc    // LTC/BTC  değeri, yukarıdaki totalLtc  nin BTC değeri
        const dogeBtcTotal = dogeBtc.bids[0]['rate'] * toalDoge  // DOGE/BTC değeri, yukarıdaki totalDoge nin BTC değeri.

        const dogeLtcTotal = dogeLtc.bids[0]['rate'] * toalDoge  // DOGE/LTC değeri, yukarıdaki toalDoge  nin LTC değeri.
        const dogeLtcBtcTotal = ltcBtc.bids[0]['rate'] * dogeLtcTotal  // DOGE/LTC nin LTC/BTC değeri , BTC değeri.
        
        coinBtc.total = totalBtc
        coinLtc.total = ltcBtcTotal 
        coinDoge.total = [dogeBtcTotal, dogeLtcBtcTotal].sort((a,b)=> b - a)[0] // coin/doge -> doge/btc ve coin/doge -> doge/ltc -> ltc/btc var hangisi büyükse onu koyacak.

        const historyTotal = history.btcPrice * 100 // test amount

        const uygunBuyMarkets = [coinBtc, coinLtc, coinDoge].filter(e=> { // aldığım fiyattan büyük olacak ama en az %1 yoksa zarar ederiz. 
            const yuzde = (e.total - historyTotal) / historyTotal * 100
            return yuzde > 1
        })

        if(uygunBuyMarkets.length > 0){
            const marketsSort = uygunBuyMarkets.sort((a,b)=> b.total - a.total) // buyların arasında en büyüğünü alıyoruz eğer 1 den fazla market varsa.
            marketsSort[0].type = 'bids' // sell kurarken priceyi buydanmı sell denmi alsın diye kontrol
            return marketsSort[0]
        }else{
            return false
        }

    }

    async HangiMarketteEnPahali(coin){
        // marketler sırayla --> ADA/BTC, ADA/LTC, ADA/DOGE ve LTC/BTC, DOGE/BTC
        const altiTickers = await this.GetAltiMarketTickers(coin)
        if(!altiTickers) return false
        const depthsKontrol = Object.keys(altiTickers).filter(e=> !altiTickers[e] || !altiTickers[e].asks || !altiTickers[e].bids) // herhangi biri boşsa veya asks veya bids i boşsa false true

        if(depthsKontrol > 0) return false // eğer 1 market bile yoksa ve depthleri yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.
        return this.FindIyiMarketiSell(altiTickers)
    }

    FindIyiMarketiSell(altiTickers){ // coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc
        const {coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc} = altiTickers
        // marketler sırayla --> ADA/BTC, ADA/LTC, ADA/DOGE ve LTC/BTC, DOGE/BTC, DOGE/LTC
        const totalBtc = this.GetMarketTotal(coinBtc) // ADA/BTC  ->  bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        const totalLtc = this.GetMarketTotal(coinLtc) // ADA/LTC  ->  1000 ada x LTC yapar değeri. LTC değer
        const toalDoge = this.GetMarketTotal(coinDoge) // ADA/DOGE ->  1000 ada x Doge yapar değeri. DOGE değer  ### BUY çünkü doge de sell e bakarsak hepsinde doge çıkar.

        const ltcBtcTotal = ltcBtc.bids[0]['rate'] * totalLtc    // LTC/BTC  değeri, yukarıdaki totalLtc  nin BTC değeri
        const dogeBtcTotal = dogeBtc.bids[0]['rate'] * toalDoge  // DOGE/BTC değeri, yukarıdaki totalDoge nin BTC değeri.

        const dogeLtcTotal = dogeLtc.bids[0]['rate'] * toalDoge  // DOGE/LTC değeri, LTC doge karşılaştırması için sell alıyoruz. yukarıdaki toalDoge  nin LTC değeri.
        const dogeLtcBtcTotal = ltcBtc.bids[0]['rate'] * dogeLtcTotal  // DOGE/LTC nin LTC/BTC değeri , BTC değeri.
        
        coinBtc.total = totalBtc
        coinLtc.total = ltcBtcTotal 
        coinDoge.total = [dogeBtcTotal, dogeLtcBtcTotal].sort((a,b)=> b - a)[0] // coin/doge -> doge/btc ve coin/doge -> doge/ltc -> ltc/btc var hangisi büyükse onu koyacak.

        const markets = [coinBtc, coinLtc, coinDoge]
        return this.VolumeKontrol(markets)
    }
     
    VolumeKontrol(markets){
        const marketNames = markets.map(e=> e.market)
        const marketTickers = this.marketTickers.Data.filter(e=> marketNames.includes(e.Label))
        const vUygunlar = markets.filter(e=> marketTickers.find(a=> a.Label == e.market && a.Volume > 0)) // Bu volumesi uygun marketleri alır.

        const uygunMarket = vUygunlar.sort((a,b)=> b.total - a.total)[0] // b-a büyükten küçüğe
        if(!uygunMarket){
            const vsizUygunMarket = markets.sort((a,b)=> b.total - a.total)[0]
            console.log(`Manuel satılması gereken coin: >>>>>  market: >>>>> ${vsizUygunMarket.market} `)
            return false
        }
        uygunMarket.type = 'asks' // sell kurarken priceyi buydanmı sell denmi alsın diye kontrol
        return uygunMarket || false // sıraya dizdikten sonra ilk en BÜYÜK marketi döndürüyoruz.
    }

    GetOrderBookGroup(d, orderBooks){
        const kontrol = this.OrderBooksKontrol(orderBooks, d)
        if(!kontrol) return false

        let { alisOrderBook, firstOrderBook, secondOrderBook, thirdOrderBook } = kontrol
        alisOrderBook = this.SetBook2(alisOrderBook, 'asks') 
        firstOrderBook = this.SetBook2(firstOrderBook, 'bids') 
        secondOrderBook = this.SetBook2(secondOrderBook, 'asks')
        thirdOrderBook = d.type == 'alt' ? this.SetBook2(thirdOrderBook, 'asks') : this.SetBook2(thirdOrderBook, 'bids') 


        return {alisOrderBook, firstOrderBook, secondOrderBook, thirdOrderBook}
    }

    SetBook2(orderBook, type){ 
        return {
            price: Number(orderBook[type][0].rate), 
            total: Number(orderBook[type][0].rate) * Number(orderBook[type][0].amount),
            market: orderBook.market,
            type
        }
    }

    OrderBooksKontrol(orderBooks, d){
        if(orderBooks.length < 4) return false
        const result = this.OrderBooksDataKontrol(orderBooks)
        if(!result) return false

        const alisOrderBook = orderBooks.find(e=> e.market == d.alisMarketName)
        const firstOrderBook = orderBooks.find(e=> e.market == d.firstMarketName)
        const secondOrderBook = orderBooks.find(e=> e.market == d.secondMarketName)
        const thirdOrderBook = orderBooks.find(e=> e.market == d.thirdMarketName)

        if(!alisOrderBook || !firstOrderBook || !secondOrderBook || !thirdOrderBook) return false

        return { alisOrderBook, firstOrderBook, secondOrderBook, thirdOrderBook }
    }

    OrderBooksDataKontrol(orderBooks){
        // order 3 ten küçükse || orderbook boşsa || asks yoksa || bids yoksa || ask 1 satohi ise || sıfırıncı bid yoksa || bid 22 satoshhiden küçükse
        for (const orderBook of orderBooks) {
            const sonuc = !orderBook || !orderBook.asks || !orderBook.asks[0] || orderBook.asks[0].rate == 0.00000001 || !orderBook.bids || !orderBook.bids[0]
            if(sonuc) return false
        }

        return true
    }

    GetMarketTotal(market, type = 'sell'){
        if(!market) return 0
        if(market.bids.length == 0) return 0
        const baseCoin = market.market.split('/')[1]
        const ondalikliSayi = this.SetPrices(market.market) // base market price giriyoruz ondalık sayı için
        let total
        if(type == 'sell'){ // sell ise asks price -1, buy ise bids price +1
            if(baseCoin == 'BTC' && market.asks[0]['rate'] < 0.0000000021) return 0 // basecoin BTC ise ve price 21 satoshiden küçükse bunu geç. 0 döndür.
            total = (market.asks[0]['rate'] - ondalikliSayi) * this.testAmount // coin o markette varsa degerini, yoksa 0 yazsın.
        }else{
            total = Number(market.bids[0]['rate']) * this.testAmount // coin o markette varsa degerini, yoksa 0 yazsın.
        }
        
        return total
    }
    
    async Submit(market, marketName, rate, amount, type){ // Bu all daha buy için (üstteki fonksiyon)
        const orderParams = [marketName, 'limit', type, amount, rate]
        
        const submitOrder = await this.ccx.exchange.createOrder(...orderParams).catch(e => {
            market.Hata = e.message
            market.date = new Date()
            this.mailDataHata.insertOne(market)
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

    
    SetBook(orderBook, type, marketName){ 
        let price = Number(orderBook[type][0].rate)
        let amount = Number(orderBook[type][0].amount)
        let total = price * amount
        const baseCoin = marketName.split('/')[1]
        let eksik = false
        if(total < this.limits[baseCoin] && orderBook[type][1]){ // 1. total yetersizse 2. totale geç ve 2. price al.
            price = Number(orderBook[type][1].rate)
            amount = amount + Number(orderBook[type][1].amount)
            total = total + (price * amount)
            eksik = true
            /*
            if(total < this.limits[baseCoin]){ // 2. total yetersiz ise 3. totale geç ve 3. price al.
                price = Number(orderBook[type][2].rate)
                amount = amount + Number(orderBook[type][2].amount)
                total = total + (price * amount)
            }
            */
        }
        return { price, amount, total, eksik }
    }

    findMarket (marketName){
        const market = this.depths[marketName]
        if(!market || !market.depths || !market.depths.bids || !market.depths.bids[0] || !market.depths.asks || !market.depths.asks[0]) return false
        return {
            market: marketName,
            ask: this.SetBook(market.depths, 'asks', marketName),
            bid: this.SetBook(market.depths, 'bids', marketName)
        }
    }

    GetAnaMarketlerData(anaCoin, firstBase, secondBase){
        const firstData = this.findMarket(anaCoin + '/' + firstBase)
        if(!firstData) return false
        const secondData = this.findMarket(anaCoin + '/' + secondBase)
        if(!secondData) return false
        return { firstData, secondData}
    }
}

module.exports = Ortak

