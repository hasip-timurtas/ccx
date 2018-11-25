const Ortak = require('./ortak')

class WsMongo {
    async LoadVeriables() {
        this.islemKati = 15
        this.minFark = 1
        this.islemdekiler = []
        this.ortak = new Ortak()
        await this.ortak.LoadVeriables('RAM')
        //await this.ortak.LoadVeriables()
        setInterval(async ()=> await this.BalanceGuncelle(), 2000 )
        setInterval(()=> console.log('Son işlenen: ' + this.sonCoin), 5000 )
        this.balances = []
        this.oncekiCoin = null
        this.orderBookCount = 10
        this.subSayac = 0
        this.steamBasla = false
        this.sonCoin = '1'
        this.fdbRoot = 'cry/min-max'
        this.ortak.db.ref(`cry/eval-min-max`).on('value', snap => eval(snap.val()))
    }

    cryWsBasla(){
        this.ortak.wsDepth.WsBaslat(coin=> this.YesYeniFunk(coin))
        this.RunForAllCoins()
    }

    async RunForAllCoins(){
        this.ortak.db.ref(this.fdbRoot).set(null)
        this.datalarString = []
        this.coins = this.ortak.marketsInfos.filter(e=> e.active && e.quote == 'BTC').map(e=> e.baseId)
        //this.coins = this.coins.filter(e=>e == 'BLOCK')
        for (const coin of this.coins) {
            if(this.islemdekiler.includes(coin) || this.ortak.mainMarkets.includes(coin) || this.ortak.wsDataProcessing || coin.includes('$')) continue
            this.YesYeniFunk(coin)
        }
        setTimeout(() => this.RunForAllCoins(), 1000 * 60 ) // 1 dk da bir refresh
    }

    async YesYeniFunk(coin){ // mix max v2
        this.islemdekiler.push(coin)
        const altiTickers = await this.ortak.GetAltiMarketTickers(coin)
        if(!altiTickers){
            this.FdbCoiniSil(coin)
            return this.IslemdekilerCikar(coin)
        }

        const SetBook = (orderBook, type) => { 
            let price = Number(orderBook[type][0].rate)
            let amount = Number(orderBook[type][0].amount)
            let total = price * amount
            const baseCoin = orderBook.market.split('/')[1]
            let eksik = false
            if(total < this.ortak.limits[baseCoin]){
                price = Number(orderBook[type][1].rate)
                amount = amount + Number(orderBook[type][1].amount)
                total = total + (price * amount)
                eksik = true
            }
            return { price, amount, total, eksik }
        }

        Object.keys(altiTickers).filter(e=> {
            const mrkt = altiTickers[e]
            altiTickers[e].ask = SetBook(mrkt, 'asks') // {price: mrkt.asks[0].rate, amount: mrkt.asks[0].amount, total: mrkt.asks[0].rate * mrkt.asks[0].amount }
            altiTickers[e].bid = SetBook(mrkt, 'bids') // {price: mrkt.bids[0].rate, amount: mrkt.bids[0].amount, total: mrkt.bids[0].rate * mrkt.bids[0].amount }
        }) 
        
        const uygunMarket = this.UygunMarketiGetir(altiTickers, coin)
        //await this.BuySellBasla(uygunMarket).catch(e=> this.IslemdekilerCikarHataEkle(e, coin))
        this.IslemdekilerCikar(coin)
    }

    UygunMarketiGetir(altiTickers, coin){ // type ask yada bid.
        const {coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc} = altiTickers
        const uygunMarkets = []
        const markets = {
            btc: {ltc:{}, doge:{}}, 
            ltc: {btc:{}, doge:{}}, 
            doge:{btc:{}, ltc:{}}
        }
        const testAmount = 100
        const getUygunMarketFormat = (first, second, fark) => ({
            firstMarket:  { name: first.market,   price: first.ask.price,   total: first.ask.total },
            secondMarket: { name: second.market,  price: second.bid.price,  total: second.bid.total },
            btcMarket:    { name: coinBtc.market, price: coinBtc.ask.price, total: coinBtc.ask.price },
            fark
        })

        const kontrol = (from, to) => {
            const firstBuy = markets[from].buyTotal
            const secondSell = markets[from][to].total
            const fark = (secondSell - firstBuy) / firstBuy * 100
            if(fark < this.minFark) return //this.FdbCoiniSil(coin)
            console.log(coin + ` - ${from} > ${to} KOŞUL UYUYOR`)
            markets[from][to].fark = fark
            from = from.replace(/^\w/, c => c.toUpperCase())
            to = to.replace(/^\w/, c => c.toUpperCase())
            const first = altiTickers['coin'+from]
            const second = altiTickers['coin'+to]
            this.FdbIslemleri(coin, first, second, fark)
            const checkTamUygun = first.ask.total >= this.ortak.limits[from.toUpperCase()] && second.bid.total >= this.ortak.limits[to.toUpperCase()] // CHECK TAM UYGUN
            if(!checkTamUygun) return
            uygunMarkets.push(getUygunMarketFormat(first, second, fark))
        }
        
        // ALINACAK MARKETLER
        markets.btc.buyTotal   = coinBtc.ask.price  * testAmount            // ADA/BTC 
        markets.ltc.buyTotal   = coinLtc.ask.price  * testAmount            // ADA/LTC
        markets.doge.buyTotal  = coinDoge.ask.price * testAmount            // ADA/DOGE
        
        // SATILACAK MARKETLER
        markets.btc.sellTotal  = coinBtc.bid.price  * testAmount            // ADA/BTC
        markets.ltc.sellTotal  = coinLtc.bid.price  * testAmount            // ADA/LTC
        markets.doge.sellTotal = coinDoge.bid.price * testAmount            // ADA/DOGE

        // BTC > LTC  #
        markets.btc.ltc.total = ltcBtc.bid.price * markets.ltc.sellTotal     // LTC/BTC
        kontrol('btc', 'ltc')

        // BTC > DOGE
        markets.btc.doge.total = dogeBtc.bid.price * markets.doge.sellTotal  // DOGE/BTC
        kontrol('btc', 'doge')

        // LTC > BTC  #
        markets.ltc.btc.total = markets.btc.sellTotal / ltcBtc.ask.price      // BTC/LTC
        kontrol('ltc', 'btc')

        // LTC > DOGE
        markets.ltc.doge.total = dogeLtc.bid.price * markets.doge.sellTotal   // DOGE/LTC
        kontrol('ltc', 'doge')

        // DOGE > BTC #
        markets.doge.btc.total = markets.btc.sellTotal / dogeBtc.ask.price    // BTC/DOGE
        kontrol('doge', 'btc')

        // DOGE > LTC 
        markets.doge.ltc.total = markets.ltc.sellTotal / dogeLtc.ask.price     // LTC/DOGE
        kontrol('doge', 'ltc')

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

        setTimeout(() => this.YesYeniFunk(coin), 10000) // 10 saniye sonra bu coin için steama gir.
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
            this.balances = balances
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
        const altCoinBtcDegeri = altCoinTotal * anaCoinPrice
        return altCoinBtcDegeri > this.ortak.limits['BTC']
    }

    async HistoryEkle(altCoin, amount, btcAskPrice ){
        await this.ortak.history.deleteMany({'coin': altCoin})
        await this.ortak.history.insertOne({'coin': altCoin, 'amount': amount, 'btcPrice': btcAskPrice, 'date': new Date() })
    }

    MailDataInsert(uygunMarket, buyResult, sellResult){
        this.ortak.mailData.insertOne({uygunMarket, buyResult, sellResult, 'date': new Date()})
    }

    MailDataBosBuyInsert(uygunMarket){
        this.ortak.mailDataBosBuy.insertOne({uygunMarket, hata: 'BUY ALMAYA YETİŞEMEDİ', 'date': new Date()})
    }

    HataEkle(e){
        if(e.message == "Cannot read property 'rate' of undefined") return
        console.log(e.message)
        this.ortak.mailDataHata.insertOne({hata : e.message})
    }

    IslemdekilerCikarHataEkle(e, coin){
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
