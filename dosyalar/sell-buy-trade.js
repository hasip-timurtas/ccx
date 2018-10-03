const Ortak = require('./ortak')
const WebSocket = require('ws')

class SellBuyTrade {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
        this.islemdekiCoinler = []
        this.minFark = 1
    }

    SellBuyTradeBaslat(coins){
        console.log(coins.length + ' adet coinle girdi.')
        for (const coin of coins) {
            if(this.islemdekiCoinler.includes(coin) || this.ortak.mainMarkets.includes(coin)) continue // coin işlemdeyse veya main marketse geç
            this.FiyatFarkKontrolYeni(coin, 'USDT', 'BTC', 'ETH').catch(e=> console.log(e))
        }
    }

    async FiyatFarkKontrolYeni(coin, fmc, smc, tmc){
        this.islemdekiCoinler.push(coin)
        await this.MarketHazirla(coin, fmc, smc,'ust', tmc, 'ust') // BTC, LTC, DOGE
        await this.MarketHazirla(coin, smc, fmc,'alt', tmc, 'ust') // LTC, BTC, DOGE
        await this.MarketHazirla(coin, tmc, fmc,'alt', smc, 'alt') // ETH, BTC, LTC
        this.islemdekiCoinler = this.islemdekiCoinler.filter(a =>  a != coin )
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
        'thirdMarketName': thidrMarketName
        }

        await this.MarketKontrolveEkle(data)
    }
    
    async MarketKontrolveEkle(d){
        const rob = await this.GetOrderBookGroup(d) // result order book yani rob
        if(!rob || !rob['firstOrderBook'] || !rob['secondOrderBook'] || !rob['thirdOrderBook'])
            return 

        //rk yani result kontrol
        const rk = this.Kontrol(d, rob['firstOrderBook'][0]['Price'], rob['secondOrderBook'][0]['Price'], rob['thirdOrderBook'][0]['Price'])
        
        if(rk.fark >= 0.2)
            console.log(rk.fark)

        if(rk['sonuc'])
            await this.UygunMarketEkle(rk, d, rob)
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
                'type': d['type'] }
            }

        const result = this.CheckTamUygun(d, rob)
        if(result)
            this.ortak.db.ref('okex/sell-buy-trade').push(uygunMarket)
            await this.BuySellBasla(uygunMarket)
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
        const marketList = [ d['firstMarketName'], d['secondMarketName'], d['thirdMarketName'] ]
        const orderBooks = await this.GetOrderBooks(marketList)

        let firstOrderBook = orderBooks.find(e=> e.market == d['firstMarketName'])
        let secondOrderBook = orderBooks.find(e=> e.market == d['secondMarketName'])
        let thirdOrderBook = orderBooks.find(e=> e.market == d['thirdMarketName'])
        
        
        if(!firstOrderBook || !secondOrderBook || !thirdOrderBook)
            return false

        if(firstOrderBook['asks'][0][0] == 0.00000001 || secondOrderBook['asks'][0][0] == 0.00000001 || thirdOrderBook['asks'][0][0] == 0.00000001)
            return false

        firstOrderBook = [{"Price": Number(firstOrderBook['asks'][0][0]),"Total": Number(firstOrderBook['asks'][0][0]) * Number(firstOrderBook['asks'][0][1])}]
        secondOrderBook = [{"Price": Number(secondOrderBook['bids'][0][0]),"Total": Number(secondOrderBook['bids'][0][0]) * Number(secondOrderBook['bids'][0][1])}]
        
        if(d['type'] == 'alt'){
            thirdOrderBook = [{"Price": Number(thirdOrderBook['asks'][0][0]),"Total": Number(thirdOrderBook['asks'][0][0]) * Number(thirdOrderBook['asks'][0][1])}]
        }else{
            thirdOrderBook = [{"Price": Number(thirdOrderBook['bids'][0][0]),"Total": Number(thirdOrderBook['bids'][0][0]) * Number(thirdOrderBook['bids'][0][1])}]
        }

        return {'firstOrderBook': firstOrderBook, 'secondOrderBook': secondOrderBook, 'thirdOrderBook': thirdOrderBook}
    }

    CheckTamUygun(d, rob){
        const firstMarketUygun = rob['firstOrderBook'][0]['Total']  >= this.ortak.limits[d['firstMainCoin']]
        const secondMarketUygun = rob['secondOrderBook'][0]['Total'] >= this.ortak.limits[d['secondMainCoin']]
        return firstMarketUygun && secondMarketUygun  // iki marketinde min tutarları uyuyorsa true döndür.
    }

    GetId() {
        return '_' + Math.random().toString(36).substr(2, 9);
    }


    // BUY SELL BAŞLA           ###############################             BUY SELL BAŞLA           ###############################                BUY SELL BAŞLA           ###############################

    async BuySellBasla(market){
        const firstMarket = market['firstMarket']
        const secondMarket = market['secondMarket']
        //thirdMarket = market['thirdMarket']
        const firstCoin = firstMarket['name'].split('/')[1]
        let amount = 0
        let total = 0
        const firstAmount = firstMarket['orderBook'][0]['Total'] / firstMarket['orderBook'][0]['Price'] // tofixed yerine round
        const secondAmount = secondMarket['orderBook'][0]['Total'] / secondMarket['orderBook'][0]['Price'] // tofixed yerine round

        if(firstAmount < secondAmount){
            amount = firstAmount
            total = secondMarket['orderBook'][0]['Total']
        }else{
            amount = secondAmount
            total = secondMarket['orderBook'][0]['Total']
        }
        
        const barajTotal = this.ortak.limits[firstCoin] * 2

        if(total > barajTotal)
            amount = barajTotal / firstMarket['orderBook'][0]['Price']
        
        const firstMarketName = firstMarket['name']

        const buyResult = await this.Submit(firstMarketName, firstMarket['orderBook'][0]['Price'], amount.toFixed(8), 'buy')
        if(buyResult){
            let sellResult = null
            let sellIptalResult = null

            if(buyResult['filled'] && buyResult['filled'] > 0){
                sellResult = await this.submit(secondMarket['name'], secondMarket['orderBook'][0]['Price'], buyResult['filled'], 'sell')
                if(sellResult && sellResult['filled'] < buyResult['filled'])
                    sellIptalResult = await this.OrderIptalEt(sellResult)
            }

            let buyIptalResult = null
            if(!buyResult['filled'] || buyResult['filled'] < amount)
                buyIptalResult = await this.OrderIptalEt(buyResult)

            Object.keys(buyResult).filter(key => !buyResult[key] && delete buyResult[key]);
            const mailDatam = {'firstMarket': firstMarketName,
                        'secondMarket': secondMarket['name'],
                        'uygunMarket': market,
                        'buyAmount': amount,
                        'sellAmount': buyResult['filled'] ? buyResult['filled'] : 0,
                        'buyResult': buyResult,
                        'sellResult': sellResult,
                        'sellIptalResult': sellIptalResult,
                        'buyIptalResult': buyIptalResult}
            this.ortak.db.ref('okex/sell-buy-trade-mailData').push(mailDatam)
            console.log('##############################     BİR İŞLEM OLDU     ##############################')
        }else{
            const mailDatam = {'firstMarket': firstMarketName,
                        'secondMarket': secondMarket['name'],
                        'uygunMarket': market,
                        'buyAmount': amount}
            this.ortak.db.ref('okex/sell-buy-trade-mailData-buy-hata').push(mailDatam)
        }
    }

    async Submit(marketName, rate, amount, type){
        const orderParams = [marketName, 'limit', type, amount, rate]
        
        const submitOrder = await this.ortak.ccx.exchange.createOrder(...orderParams).catch(e => {
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

    WsBaslat(){
        var wsApi = new WebSocket("wss://okexcomreal.bafang.com:10441/websocket");
        var message = "{event:'addChannel',parameters:{'binary':'0','type':'all_ticker_3s'}}"
        var pingMsg = `{'event':'ping'}`

        wsApi.onmessage = (msg) => {
            var data = JSON.parse(msg.data)
            if(data.event == 'pong' || data.data.result) return // pong değilse array gelecek.
            var coins = data.data.filter(e=> {
                if(e.id.includes('t-')){
                    var coin = e.id.replace('t-','').split('_')[0].toUpperCase()
                    var baseCoin = e.id.replace('t-','').split('_')[1].toUpperCase()
                    e.coin = coin
                    return baseCoin != 'OKB'                    
                }else{
                    return false
                }
            })
            coins = coins.map(e=> e.coin)
            let unique = [...new Set(coins)]; 
            this.SellBuyTradeBaslat(unique)
        }

        wsApi.onerror = (err) =>{
            console.log(err);
        }

        wsApi.onclose= () => {
            setTimeout(() => { this.WsBaslat() }, 2000); // bağlantı koptuğunda 2 saniye sonra birdaha bağlan
        }
    
        wsApi.onopen = () =>{
            wsApi.send(message)
            setInterval(()=> wsApi.send(pingMsg), 20 * 1000) // 20 saniyede bir ping atar.
        }
    }
}

module.exports = SellBuyTrade

async function BaslaBuy() {
    var sellBuyTrade = new SellBuyTrade()
    await sellBuyTrade.LoadVeriables()
    sellBuyTrade.WsBaslat()
}

BaslaBuy()