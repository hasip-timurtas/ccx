const Ortak = require('./ortak')

class WsMongo {
    async LoadVeriables() {
        this.islemKati = 15
        this.minFark = 1
        this.islemdekiler = []
        this.ortak = new Ortak()
        await this.ortak.LoadVeriables('MONGO')
        //await this.ortak.LoadVeriables()
        setInterval(async ()=> await this.BalanceGuncelle(), 2000 )
        setInterval(()=> console.log('Son işlenen: ' + this.sonCoin + ' RunForAllCoinsPromise sayac: '+ this.RunForAllCoinsPromiseSayac), 5000 )
        this.balances = []
        this.oncekiCoin = null
        this.orderBookCount = 10
        this.subSayac = 0
        this.steamBasla = false
        this.sonCoin = '1'
        this.site = 'okex'
        this.proje = 'buy-sell'
        this.fdbRoot = this.site + '/' + this.proje
        this.ortak.db.ref(this.site + '/eval' + this.proje).on('value', snap => {
            try { eval(snap.val()) } catch (error) { console.log('Çalıştırılan kod hatalı')}
        })
        this.datalarString = []
        this.RunForAllCoinsPromiseSayac = 0
    }
    
    cryWsBasla(){
        this.cryWsBaslaAll()
        //this.RunForAllCoinsPromise() // test 1 defa için.
        return
        this.ortak.db.ref(this.fdbRoot).set(null)
        this.datalarString = []
        this.YesYeniFunk('ADA')
        //this.ortak.wsDepth.WsBaslat(coin=> this.YesYeniFunk(coin))
        //this.RunForAllCoins()
    }

    async cryWsBaslaAll(){
        this.ortak.db.ref(this.fdbRoot).set(null)
        this.datalarString = []
        //this.ortak.wsDepth.WsBaslat()
        while(true){
            await this.RunForAllCoinsPromise()
        }
    }

    async RunForAllCoinsPromise(){
        this.ortak.db.ref(this.fdbRoot).set(null)
        this.datalarString = []
        this.coins = this.ortak.marketsInfos.filter(e=> e.active && e.quote == 'BTC').map(e=> e.baseId.toUpperCase())
        this.allOrderBooks = await this.ortak.GetOrderBooks(null,true) // Hepsini alıyoruz.
        const promises = []
        while(this.ortak.wsDataProcessing){
            await this.ortak.sleep(2)
        }
        for (const coin of this.coins) {
            promises.push(this.YesYeniFunk(coin))
        }
        await Promise.all(promises).catch(e=> console.log(e))
        this.RunForAllCoinsPromiseSayac++
    }

    async YesYeniFunk(coin){ // mix max v2
        if(this.islemdekiler.includes(coin) || this.ortak.mainMarkets.includes(coin) || this.ortak.wsDataProcessing || coin.includes('$')) return
        this.islemdekiler.push(coin)
        const altiTickers = this.GetAltiMarketTickers(coin)
           
        Object.keys(altiTickers).filter(e=> {
            const mrkt = altiTickers[e]
            altiTickers[e].ask = this.ortak.SetBook(mrkt, 'asks', mrkt.market) // {price: mrkt.asks[0].rate, amount: mrkt.asks[0].amount, total: mrkt.asks[0].rate * mrkt.asks[0].amount }
            altiTickers[e].bid = this.ortak.SetBook(mrkt, 'bids', mrkt.market) // {price: mrkt.bids[0].rate, amount: mrkt.bids[0].amount, total: mrkt.bids[0].rate * mrkt.bids[0].amount }
        }) 
        
        const kontrols = this.YesYeniFunkKontrols(coin, altiTickers)
        if(!kontrols) return
        const uygunMarket = this.UygunMarketiGetir(altiTickers, coin)
        if(uygunMarket) await this.BuySellBasla(uygunMarket).catch(e=> this.IslemdekilerCikarHataEkle(e, coin))
        this.IslemdekilerCikar(coin)
        this.sonCoin = coin
    }

    YesYeniFunkKontrols(coin, altiTickers){
        let check = true
        for (const i of Object.keys(altiTickers)) {
            const mrkt = altiTickers[i]
            if(!mrkt) check = false
        }

        if(!altiTickers || !check){
            this.FdbCoiniSil(coin)
            this.IslemdekilerCikar(coin)
            return false
        }

        return true
    }


    GetUygunMarketFormat(first, second, fark, coinUsdt){
        return {
            firstMarket:  { name: first.market,   price: first.ask.price,   total: first.ask.total },
            secondMarket: { name: second.market,  price: second.bid.price,  total: second.bid.total },
            btcMarket:    { name: coinUsdt.market, price: coinUsdt.ask.price, total: coinUsdt.ask.price },
            fark
        }
    }

    UygunMarketiGetir(altiTickers, coin){ // type ask yada bid.
        const {coinUsdt, coinBtc, coinEth, btcUsdt, ethUsdt, ethBtc} = altiTickers
        const uygunMarkets = []
        const markets = { usdt: {btc:{}, eth:{}}, btc: {usdt:{}, eth:{}}, eth:{usdt:{}, btc:{}} }
        const testAmount = 100

        const kontrol = (from, to) => {
            const firstBuy = markets[from].buyTotal
            const secondSell = markets[from][to].total
            const fark = (secondSell - firstBuy) / firstBuy * 100
            if(fark > 0.2) console.log(coin + ' '+ fark.toFixed(2))
            if(fark < this.minFark) return //this.FdbCoiniSil(coin)
            markets[from][to].fark = fark
            from = from.replace(/^\w/, c => c.toUpperCase())
            to = to.replace(/^\w/, c => c.toUpperCase())
            const first = altiTickers['coin'+from]
            const second = altiTickers['coin'+to]
            this.FdbIslemleri(coin, first, second, fark)
            const checkTamUygun = first.ask.total >= this.ortak.limits[from.toUpperCase()] && second.bid.total >= this.ortak.limits[to.toUpperCase()] // CHECK TAM UYGUN
            if(!checkTamUygun) return
            console.log(coin + ` - ${from} > ${to} KOŞUL UYUYOR`)
            const marketFrmt = this.GetUygunMarketFormat(first, second, fark, coinUsdt)
            this.ortak.db.ref(this.fdbRoot+"-uygunlar").push(coin).set(marketFrmt)
            uygunMarkets.push(marketFrmt)
        }
        
        // ALINACAK MARKETLER
        markets.usdt.buyTotal   = coinUsdt.ask.price  * testAmount            // ADA/BTC 
        markets.btc.buyTotal   = coinBtc.ask.price  * testAmount            // ADA/LTC
        markets.eth.buyTotal  = coinEth.ask.price * testAmount            // ADA/DOGE
        
        // SATILACAK MARKETLER
        markets.usdt.sellTotal  = coinUsdt.bid.price  * testAmount            // ADA/BTC
        markets.btc.sellTotal  = coinBtc.bid.price  * testAmount            // ADA/LTC
        markets.eth.sellTotal = coinEth.bid.price * testAmount            // ADA/DOGE

        // BTC > LTC  #
        markets.usdt.btc.total = btcUsdt.bid.price * markets.btc.sellTotal     // LTC/BTC
        kontrol('usdt', 'btc')

        // BTC > DOGE
        markets.usdt.eth.total = ethUsdt.bid.price * markets.eth.sellTotal  // DOGE/BTC
        kontrol('usdt', 'eth')

        // LTC > BTC  #
        markets.btc.usdt.total = markets.usdt.sellTotal / btcUsdt.ask.price      // BTC/LTC
        kontrol('btc', 'usdt')

        // LTC > DOGE
        markets.btc.eth.total = ethBtc.bid.price * markets.eth.sellTotal   // DOGE/LTC
        kontrol('btc', 'eth')

        // DOGE > BTC #
        markets.eth.usdt.total = markets.usdt.sellTotal / ethUsdt.ask.price    // BTC/DOGE
        kontrol('eth', 'usdt')

        // DOGE > LTC 
        markets.eth.btc.total = markets.btc.sellTotal / ethBtc.ask.price     // LTC/DOGE
        kontrol('eth', 'btc')

        if(uygunMarkets.length == 0) return false
        uygunMarkets.sort((a,b)=> b.fark - a.fark)
        const farkiEnYuksekMarket = uygunMarkets[0]
        return farkiEnYuksekMarket
    }

    FdbIslemleri(coin, first, second, fark){
        const firstTotalUygun = first.ask.total >= this.ortak.limits[first.market.split('/')[1]]
        const secondTotalUygun = second.bid.total >= this.ortak.limits[second.market.split('/')[1]]
        const totalUygun = firstTotalUygun && secondTotalUygun
        const uygunMarket = {
            firstName: first.market,
            secondName: second.market,
            firstMarket:  { price: first.ask.price.toFixed(8), amount: first.ask.amount.toFixed(8), total: first.ask.total.toFixed(8), totalUygun: firstTotalUygun  }, // TODO: tofixed kaldır.
            secondMarket: { price: second.bid.price.toFixed(8), amount: second.bid.amount.toFixed(8), total: second.bid.total.toFixed(8), totalUygun: secondTotalUygun },// TODO: tofixed kaldır.
            totalUygun,
            fark: fark.toFixed(2)
        }

        const fdbName = first.market.replace('/','-') + '--' + second.market.replace('/','-')
        if(this.datalarString[fdbName] != JSON.stringify(uygunMarket)){ // Datalar aynı değilse ise kaydet değilse tekrar kontrole git.
            this.datalarString[fdbName] = JSON.stringify(uygunMarket)
            this.ortak.db.ref(this.fdbRoot).child(coin).child(fdbName).set(uygunMarket)
        }

        //setTimeout(() => this.YesYeniFunk(coin), 10000) // 10 saniye sonra bu coin için steama gir.
    }

    async BuySellBasla(market){
        const { firstMarket, secondMarket, btcMarket } = market
        const altCoin = firstMarket.name.split('/')[0]
        let { baseCoin, amount, total } = this.BaseCoinAmountTotalGetir(firstMarket, secondMarket)

        const kontrol =  this.BuyBaslaKontroller(btcMarket, altCoin, baseCoin, total )
        if(!kontrol) return

        const buyResult = await this.ortak.SubmitMongo(market, firstMarket.name, firstMarket.price, amount, 'buy')

        if(buyResult) await this.BuyuSellYap({ buyResult, market, secondMarket, amount, altCoin, btcMarket })
    }

    BaseCoinAmountTotalGetir( firstMarket, secondMarket ){
        let baseCoin, amount, total, price
        let firstAmount = firstMarket.total / firstMarket.price // tofixed yerine round
        let secondAmount = secondMarket.total / secondMarket.price // tofixed yerine round
        firstAmount = Number(firstAmount.toFixed(8))
        secondAmount = Number(secondAmount.toFixed(8))

        if(firstAmount < secondAmount){
            amount = firstAmount
            total = firstMarket.total
            price = firstMarket.price
            baseCoin = firstMarket.name.split('/')[1]
        }else{
            amount = secondAmount
            total = secondMarket.total
            price = secondMarket.price
            baseCoin = secondMarket.name.split('/')[1]
        }

        total = Number(total.toFixed(8))

        const barajTotal = this.ortak.limits[baseCoin] * this.islemKati

        if(total > barajTotal){
            amount = barajTotal / price
            amount = Number(amount.toFixed(8))
        }

        return { baseCoin, amount, total }
    }

    BuyBaslaKontroller(btcMarket, altCoin, baseCoin, total ){
        if(total < this.ortak.limits[baseCoin]){
            console.log('Alınacak total yeterli değil');
            return false // total lititten küçükse dön
        }

        const balanceVar = this.BalanceKontrol(btcMarket.price, altCoin)
        if(balanceVar){
            console.log('Yeterince balance var. ÇIK', altCoin)
            return false
        }
        
        return true
    }

    async BuyuSellYap(data){
        const { buyResult, market, secondMarket, amount, altCoin, btcMarket } = data
        let sellResult

            if(buyResult.filled && buyResult.filled > 0){
                sellResult = await this.ortak.SubmitMongo(market, secondMarket.name, secondMarket.price, buyResult.filled, 'sell')
                if(sellResult && sellResult.filled < buyResult.filled){
                    await this.ortak.OrderIptalEt(sellResult)
                    const kalanAmount = buyResult.filled - sellResult.filled
                    this.HistoryEkle(altCoin, kalanAmount, btcMarket.price)
                }
            }

            if(!buyResult.filled || buyResult.filled < amount) await this.ortak.OrderIptalEt(buyResult)
            if(buyResult.filled == 0) return this.MailDataBosBuyInsert(market)

            this.MailDataInsert(market, buyResult, sellResult)
            console.log('##############################     BİR İŞLEM OLDU     ##############################')
    }

    async BalanceGuncelle(){
        const balances = await this.ortak.GetBalance().catch(e=> this.HataEkle(e))
        if(balances){
            this.balances = balances.filter(e=>{
                e.Symbol = e.Symbol.toUpperCase()
                return true
            })
        }
    }

    BalanceKontrol(anaCoinPrice, altCoin){
        //const balances = await this.ortak.GetBalance()
        let altCoinBalance = this.balances.find(e=> e.Symbol == altCoin) //balances[altCoin]['total']
        if(!altCoinBalance) {
            console.log('#####      Balancekontrol altcoin boş !!!!')
            return true // hata olduğu için balance var dönüyoruz. yani işlem yapmasın.
        } 
        let altCoinTotal = altCoinBalance.Total
        const altcoinUsdtDegeri = altCoinTotal * anaCoinPrice
        return altcoinUsdtDegeri > this.ortak.limits['BTC']
    }

    async HistoryEkle(altCoin, amount, btcAskPrice ){
        await this.ortak.history.deleteMany({'coin': altCoin})
        await this.ortak.history.insertOne({'coin': altCoin, 'amount': amount, 'btcPrice': btcAskPrice, 'date': new Date() })
    }

    async MailDataInsert(uygunMarket, buyResult, sellResult){
        this.ortak.mailData.insertOne({uygunMarket, buyResult, sellResult, 'date': new Date()})
    }

    async MailDataBosBuyInsert(uygunMarket){
        this.ortak.mailDataBosBuy.insertOne({uygunMarket, hata: 'BUY ALMAYA YETİŞEMEDİ', 'date': new Date()})
    }

    async HataEkle(e){
        if(e.message == "Cannot read property 'rate' of undefined") return
        console.log(e.message)
        this.ortak.mailDataHata.insertOne({hata : e.message})
    }

    async IslemdekilerCikarHataEkle(e, coin){
        if(e.message == "Cannot read property 'rate' of undefined") return
        console.log(e.message)
        this.ortak.mailDataHata.insertOne({hata : e.message})
        this.IslemdekilerCikar(coin)
    }

    IslemdekilerCikar(coin){
        this.islemdekiler = this.islemdekiler.filter(a => a != coin)
    }

    // #################       -- MIN MAX --       #################

    FdbCoiniSil(coin, marketName){
        if(marketName){
            this.ortak.db.ref(this.fdbRoot).child(coin).child(marketName).set(null)
        }else{
            this.ortak.db.ref(this.fdbRoot).child(coin).set(null)
        }
    }

    GetAltiMarketTickers(coin){
        // mainMarkets -> ['BTC', 'LTC', 'DOGE']
        const marketler = [
            coin + "/" + this.ortak.mainMarkets[0], // ADA/BTC
            coin + "/" + this.ortak.mainMarkets[1], // ADA/LTC
            coin + "/" + this.ortak.mainMarkets[2], // ADA/DOGE
            this.ortak.mainMarkets[1] + "/" + this.ortak.mainMarkets[0], // LTC/BTC
            this.ortak.mainMarkets[2] + "/" + this.ortak.mainMarkets[0], // DOGE/BTC
            this.ortak.mainMarkets[2] + "/" + this.ortak.mainMarkets[1]  // DOGE/LTC
        ]

        let orderBooks = this.allOrderBooks.filter(e=> marketler.includes(e.market))
        const result = this.ortak.OrderBooksDataKontrol(orderBooks)
        
        if(!result || orderBooks.length < 6){
            return false
            //orderBooks = await this.GetOrderBookGroupRest(coin)
        }

        if(!orderBooks) return false
        
        //coinUsdt, coinBtc, coinEth, btcUsdt, ethUsdt, ethBtc
        return { 
            coinUsdt : orderBooks.find(e => e.market == marketler[0]),
            coinBtc : orderBooks.find(e => e.market == marketler[1]),
            coinEth: orderBooks.find(e => e.market == marketler[2]),
            btcUsdt  : orderBooks.find(e => e.market == marketler[3]),
            ethUsdt : orderBooks.find(e => e.market == marketler[4]),
            ethBtc : orderBooks.find(e => e.market == marketler[5])
        }
    }
    
}


let sayac = 0
let cryBuy

async function Basla(){
    sayac++
    cryBuy = new WsMongo()
    await cryBuy.LoadVeriables('MONGO')
    cryBuy.ortak.wsZamanlayici = 10 // dakika
    cryBuy.cryWsBasla()
    
    while(cryBuy.ortak.wsDataProcessing){
        await cryBuy.ortak.sleep(1)
    }
    console.log('Sayaç Çalışma süresi: ' + sayac)
}

Basla()


async function deneme() {
    var promises = []
    for (let i = 1; i < 11; i++) {
        promises.push(proFunc(i))
    }

    await Promise.all(promises)
    console.log('ALL İŞLEM BİTTİ')
}

async function proFunc(i) {
    await new Promise(resolve => setTimeout(resolve, i * 1000))
    console.log(i + ' işlem bitti')
}