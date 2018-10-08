const mongodb = require('mongodb')
const firebase = require('firebase-admin')
const rp = require('request-promise')
const MhtCcxt = require('../dll/mhtCcxt')
const serviceAccount = require("../dll/firebase.json")
firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://firem-b3432.firebaseio.com"
})

const mongoUrl = "mongodb://209.250.238.100:1453/";

class Ortak {
    async LoadVeriables(){
        this.mainMarkets = ['BTC', 'LTC', 'DOGE']
        this.site = 'cryptopia'
        const key = "dbec90fd39294e1fa90db54e404c2edc" // hasip4441 cry
        const secret = "D3tx+b8gb3Me2z3T/D/gzMdRWfNbR9vfYyf/RiqdJzc="
        this.ccx = new MhtCcxt(key, secret, this.site, null)
        this.limits = { "BTC": 0.0006, "ETH": 0.011, "LTC": 0.06, "DOGE": 1250, "BNB":5.1, "USD": 5, "USDT": 5 }
        this.volumeLimtis = { "BTC": 0.5, "ETH": 10, "LTC": 50, "DOGE": 1000, "BNB":250, "USD":3250, "USDT":3250 }
        this.db = firebase.database();
        const connection = await mongodb.MongoClient.connect(mongoUrl, { useNewUrlParser: true });
        const cnn = connection.db('cry')
        this.depths = cnn.collection('depths')
        this.fbBalances = cnn.collection('balances')
        this.history = cnn.collection('history')
        this.openOrders = cnn.collection('openOrders')
        this.marketsInfos = await this.ccx.exchange.load_markets().catch(e=> console.log(e) )
        this.marketsInfos = Object.keys(this.marketsInfos).map(e=> this.marketsInfos[e])
        this.marketTickers = await this.ccx.GetMarkets().catch(e=> console.log(e))
        this.islemdekiCoinler = []
    }

    async Submit(marketName, rate, amount, type){
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

    async OpenOrderVarMi(marketName, type){
        let openOrders = await this.db.ref(`cry/${type}-open-orders`).once('value').then(snapshot => snapshot.val())
        if(!openOrders) return false // hiç order yoksa false dönder.
        openOrders = Object.keys(openOrders).map(e=> openOrders[e])
        const order = openOrders.find(e=> e.market.includes(marketName))
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

    async HangiMarketteEnPahali(coin){
        // marketler sırayla --> ADA/USDT, ADA/BTC, ADA/ETH ve BTC/USDT, ETH/USDT
        const besTickers = await this.GetBesMarketTickers(coin)
        if(!besTickers) return false
        const { market1, market2, market3, market4, market5 } = besTickers //await this.GetBesMarketTickers(coin)
        const depthsKontrol = !market1 || !market1.asks || !market2 || !market2.asks || !market3 || !market3.asks || !market4 || !market4.asks || !market5 || !market5.asks

        if(depthsKontrol) return false // eğer 1 market bile yoksa ve depthleri yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.

        const coinMarket2Total = this.GetMarketTotal(market2)  // ADA/BTC
        const coinMarket3Total = this.GetMarketTotal(market3)  // ADA/ETH
        

        market1.total = this.GetMarketTotal(market1)  // ADA/USDT  değeri  -> bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        market2.total = market4.asks[0][0] * coinMarket2Total // BTC/USDT  değeri
        market3.total = market5.asks[0][0] * coinMarket3Total  // ETH/USDT  değeri

        const markets = [market1, market2, market3]
        const volumeliMarkets = markets.filter(e=> {
            const volumeUygun = this.marketTickers.Data.find(a=> a.Label == e.market && a.Volume > 0)
            return volumeUygun
        })

        if(volumeliMarkets.length < 3){
            var dur = 2
        }
        const volumeliUygunMarket = volumeliMarkets.sort((a,b)=> b.total - a.total)[0] // b-a büyükten küçüğe
        if(!volumeliUygunMarket){
            const vsizUygunMarket = markets.sort((a,b)=> b.total - a.total)[0]
            console.log(`Manuel satılması gereken coin: >>>>> ${coin}   market: >>>>> ${vsizUygunMarket.market} `)
            return false
        }
        volumeliUygunMarket.type = 'asks' // sell kurarken priceyi buydanmı sell denmi alsın diye kontrol
        return volumeliUygunMarket || false // sıraya dizdikten sonra ilk en BÜYÜK marketi döndürüyoruz.
    }

    async HangiMarketteEnPahaliBuy(coin){ // Buy için en pahalı market
        // marketler sırayla --> ADA/USDT, ADA/BTC, ADA/ETH ve BTC/USDT, ETH/USDT
        const { market1, market2, market3, market4, market5 } = await this.GetBesMarketTickers(coin)
        const depthsKontrol = !market1 || !market1.asks || !market2 || !market2.asks || !market3 || !market3.asks || !market4 || !market4.asks || !market5 || !market5.asks

        if(depthsKontrol) return false // eğer 1 market bile yoksa ve depthleri yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.
        const coinMarket2Total = this.GetMarketTotal(market2, 'buy')  // ADA/BTC
        const coinMarket3Total = this.GetMarketTotal(market3, 'buy')  // ADA/ETH
        

        market1.total = this.GetMarketTotal(market1, 'buy')  // ADA/USDT  değeri  -> bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        market2.total = market4.bids[0][0] * coinMarket2Total // BTC/USDT  değeri
        market3.total = market5.bids[0][0] * coinMarket3Total  // ETH/USDT  değeri

        let history = await this.GetHistory(coin) // coinin en son alındığı fiyatı verir.
        if(!history) return false // history yoksa direk false döndür.
        //history = history.sort((a,b)=> b.date - a.date) // en son history kaydını alıyoruz.

        const historyTotal = history.btcPrice * 100 // test amount

        const uygunBuyMarkets = [market1, market2, market3].filter(e=> { // aldığım fiyattan büyük olacak ama en az %1 yoksa zarar ederiz. 
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

    async HangiMarketteEnUcuz(coin){
        // marketler sırayla --> ADA/USDT, ADA/BTC, ADA/ETH ve BTC/USDT, ETH/USDT
        const { market1, market2, market3, market4, market5 } = await this.GetBesMarketTickers(coin)
        
        if(!market1) return false // eğer 1 market bile yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.

        const coinMarket2Total = this.GetMarketTotal(market2, 'buy')  // ADA/BTC
        const coinMarket3Total = this.GetMarketTotal(market3, 'buy')  // ADA/ETH
        

        market1.total = this.GetMarketTotal(market1, 'buy')  // ADA/USDT  değeri  -> bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        market2.total = market4.bids[0][0] * coinMarket2Total // BTC/USDT  değeri
        market3.total = market5.bids[0][0] * coinMarket3Total  // ETH/USDT  değeri

        const markets = [market1, market2, market3].sort((a,b)=> a.total - b.total) // a-b küçükten büğüğe
        return markets[0] || false // sıraya dizdikten sonra ilk en KÜÇÜK marketi döndürüyoruz.
    }


    GetMarketTotal(market, type = 'sell'){
        if(!market) return 0
        if(market.bids.length == 0) return 0
        const baseCoin = market.market.split('/')[1]
        const testAmount = 100
        const ondalikliSayi = this.SetPrices(market.market) // base market price giriyoruz ondalık sayı için
        let total
        if(type == 'sell'){ // sell ise asks price -1, buy ise bids price +1
            total = (market.asks[0][0] - ondalikliSayi) * testAmount // coin o markette varsa degerini, yoksa 0 yazsın.
        }else{
            total = (Number(market.bids[0][0]) + ondalikliSayi) * testAmount // coin o markette varsa degerini, yoksa 0 yazsın.
        }
        
        if(baseCoin == 'BTC' && market.asks[0][0] < 0.0000000021) return 0 // basecoin BTC ise ve price 21 satoshiden küçükse bunu geç. 0 döndür.
        return total
    }

    async GetBesMarketTickers(coin){
        const marketler = [
            coin + "/" + this.mainMarkets[0], 
            coin + "/" + this.mainMarkets[1], 
            coin + "/" + this.mainMarkets[2], 
            this.mainMarkets[1] + "/" + this.mainMarkets[0], 
            this.mainMarkets[2] + "/" + this.mainMarkets[0]
        ]
        let orderBooks = await this.GetOrderBooks(marketler)
        if(orderBooks.length < 5){
            orderBooks = await this.GetOrderBookGroupRest(coin)
        }

        if(!orderBooks) return false

        return { 
            market1: orderBooks.find(e => e.market == marketler[0]),
            market2: orderBooks.find(e => e.market == marketler[1]),
            market3: orderBooks.find(e => e.market == marketler[2]),
            market4: orderBooks.find(e => e.market == marketler[3]),
            market5: orderBooks.find(e => e.market == marketler[4])
        }
    }

    async GetOrderBooks(marketler){
        let orderBooks = await this.depths.find( { 'market': { '$in': marketler } } ).toArray()
        orderBooks = orderBooks.map(e=> {
            if(!e.depths){
                return e
            }
            e.depths.market = e.market
            return e.depths
        }) //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
        
        return orderBooks
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

        var secilenSellPrice = marketOrders[type].find(e => Number(e[0]) == openOrder.price)
        result.sellSirasi = secilenSellPrice && marketOrders[type].indexOf(secilenSellPrice) + 1
        result.ikinciSellPrice = Number(marketOrders[type][1][0]) // ikinci sıradakinin buy price.. [1][1] olsaydı 2. sıradakinin amountu olurdu.
        result.ilkSellTutar = marketOrders[type][0][1]
        result.ilkSellTutar = Number(result.ilkSellTutar)

        return result
    }

    OndekiTutarKontrolu(sira, marketOrders, type){
        var ilkinTutari = marketOrders[type][0][0] * marketOrders[type][0][1]  // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkVeIkincininTutari = ilkinTutari + marketOrders[type][1][0] * marketOrders[type][1][1] // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkIkiVeUcuncununTutari = ilkVeIkincininTutari + marketOrders[type][2][0] * marketOrders[type][2][1]
        
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
        if(!balances){
            return await this.GetBalance()
        }
        balances = balances.Data.filter(e=> e.Status == 'OK')
        return balances
    }

    async fbBalancesUpdate(totalBalances){
        await this.fbBalances.deleteMany({})
        this.fbBalances.insertMany(totalBalances)
    }

    async GetTickers(marketler){
        let tickers = await this.depths.find( { 'market': { '$in': marketler } } ).toArray()
        tickers = tickers.map(e=> {
            e.ticker.market = e.market
            return e.ticker
        }) //  içinde market ismi olan tickeri gönderiyoruz. orjinalinde yok.
        return tickers
    }

    async GetOrderBook(marketName){
        
        let marketOrders = await this.depths.findOne({ market: marketName } )
        if(!marketOrders){
            return await this.GetOrderBooksRest(marketName) 
        }
        marketOrders = marketOrders.depths
        
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

    async DeleteOrderFb(order, type){
        await this.openOrders.deleteOne({orderId: order.orderId})
        /*
        const marketNameFb = order.market.replace('/','_') + '-' +  order.orderId
        await this.db.ref(`cry/${type}-open-orders`).child(marketNameFb).set(null)
        */
    }

    async InsertOrderFb(order, type){
        
        const total = order.price * order.amount
        const data = {
            orderId: order.id,
            market: order.symbol,
            price: order.price,
            amount: order.amount,
            total: total
        }

        await this.openOrders.insertOne(data)

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

    async GetFbData(path){
        return await this.openOrders.find().toArray()
        //return await this.db.ref(path).once('value').then(e => e.val())
    }
    
    async GetOrderBookGroupRest(coin){
        const marketler = [
            coin + "/" + this.mainMarkets[0], 
            coin + "/" + this.mainMarkets[1], 
            coin + "/" + this.mainMarkets[2], 
            this.mainMarkets[1] + "/" + this.mainMarkets[0], 
            this.mainMarkets[2] + "/" + this.mainMarkets[0]
        ]

        const marketlerString = marketler.map(e=> e.replace('/','_')).join('-')//coin + "_BTC-" + coin + "_LTC-"+ coin + "_DOGE-" + "DOGE_BTC-LTC_BTC"
        const fullUrl = `https://www.cryptopia.co.nz/api/GetMarketOrderGroups/${marketlerString}/10`
        const result = await rp(fullUrl).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(!result.Data) return await this.GetOrderBookGroupRest(coin);
        if(result.Data.length < 5 ) return false

        let uygunFormat = marketler.map(e=> {
            var market = result.Data.find(x => x.Market == e.replace('/','_')) //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
            return { 
                bids: market.Buy ? market.Buy.map(a=> ([a.Price, a.Total / a.Price ])) : [], 
                asks: market.Sell.map(a=> ([a.Price, a.Total / a.Price ])),
                market: e
            }
        })

       return uygunFormat   
    }

    async GetOrderBooksRest(marketName){
        const fullUrl = `https://www.cryptopia.co.nz/api/GetMarketOrders/${marketName.replace('/','_')}`
        const result = await rp(fullUrl).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(!result.Data) return await this.GetOrderBooksRest(marketName);

        var market = result.Data //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
        var data =  { 
            bids: market.Buy.map(a=> ([a.Price, a.Total / a.Price ])), 
            asks: market.Sell.map(a=> ([a.Price, a.Total / a.Price ])),
            market: marketName
        }
        return data  
    }
}

module.exports = Ortak

