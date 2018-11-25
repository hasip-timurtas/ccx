const Ortak = require('./ortak')

class WsMongo {
    async LoadVeriables() {
        this.type = 'ALTCOIN'
        this.islemKati = 15
        this.minFark = 1
        this.islemdekiler = []
        this.ortak = new Ortak()
        await this.ortak.LoadVeriables(this.type)
        //await this.ortak.LoadVeriables()
        setInterval(async ()=> await this.BalanceGuncelle(), 2000 )
        setInterval(()=> console.log('Son işlenen: ' + this.sonCoin), 5000 )
        this.balances = []
        this.oncekiCoin = null
        this.orderBookCount = 10
        this.subSayac = 0
        this.steamBasla = false
        this.sonCoin = '1'
        this.site = 'cry'
        this.proje = 'altcoin-buy-sell'
        this.fdbRoot = this.site + '/' + this.proje
        this.ortak.db.ref(this.site + '/eval' + this.proje).on('value', snap => {
            try { eval(snap.val()) } catch (error) { console.log('Çalıştırılan kod hatalı')}
        })
        this.allCoins = this.ortak.marketsInfos.filter(e=> e.active && e.quote == 'BTC').map(e=> e.baseId)
    }

    cryWsBasla(){
        this.ortak.db.ref(this.fdbRoot).set(null)
        this.datalarString = []
        //this.AltcoinCheck('RDD')
        if(this.type == 'RAM' || this.type == 'ALTCOIN') this.ortak.wsDepth.WsBaslat(coin=> this.AltcoinCheck(coin))
    }

    async RunForAllCoins(){
        this.ortak.db.ref(this.fdbRoot).set(null)
        this.datalarString = []
        this.coins = this.ortak.marketsInfos.filter(e=> e.active && e.quote == 'BTC').map(e=> e.baseId)
        //this.coins = this.coins.filter(e=>e == 'BLOCK')
        while(this.ortak.wsDataProcessing){
            await this.ortak.sleep(2)
        }
        for (const coin of this.coins) {
            if(this.islemdekiler.includes(coin) || this.ortak.mainMarkets.includes(coin) || this.ortak.wsDataProcessing || coin.includes('$')) continue
            this.AltcoinCheck(coin)
        }
        setTimeout(() => this.RunForAllCoins(), 1000 * 60 ) // 1 dk da bir refresh
    }

    SetBook(orderBook, type, marketName){ 
        let price = Number(orderBook[type][0].rate)
        let amount = Number(orderBook[type][0].amount)
        let total = price * amount
        const baseCoin = marketName.split('/')[1]
        let eksik = false
        if(total < this.ortak.limits[baseCoin] && orderBook[type][1]){
            price = Number(orderBook[type][1].rate)
            amount = amount + Number(orderBook[type][1].amount)
            total = total + (price * amount)
            eksik = true
        }
        return { price, amount, total, eksik }
    }

    async YesYeniFunk(coin){ // mix max v2
        if(this.islemdekiler.includes(coin) || this.ortak.mainMarkets.includes(coin) || this.ortak.wsDataProcessing || coin.includes('$')) return
        this.islemdekiler.push(coin)
        const altiTickers = await this.ortak.GetAltiMarketTickers(coin)
        if(!altiTickers){
            this.FdbCoiniSil(coin)
            return this.IslemdekilerCikar(coin)
        }

        Object.keys(altiTickers).filter(e=> {
            const mrkt = altiTickers[e]
            altiTickers[e].ask = this.SetBook(mrkt, 'asks') // {price: mrkt.asks[0].rate, amount: mrkt.asks[0].amount, total: mrkt.asks[0].rate * mrkt.asks[0].amount }
            altiTickers[e].bid = this.SetBook(mrkt, 'bids') // {price: mrkt.bids[0].rate, amount: mrkt.bids[0].amount, total: mrkt.bids[0].rate * mrkt.bids[0].amount }
        }) 
        
        const uygunMarket = this.UygunMarketiGetir(altiTickers, coin)
        if(uygunMarket) await this.BuySellBasla(uygunMarket).catch(e=> this.IslemdekilerCikarHataEkle(e, coin))
        this.IslemdekilerCikar(coin)
        this.sonCoin = coin
    }

    async AltcoinCheck(anaCoin){
        if(this.islemdekiler.includes(anaCoin) || this.ortak.mainMarkets.includes(anaCoin) || this.ortak.wsDataProcessing || anaCoin.includes('$')) return
        //const orderBooks = await this.ortak.GetOrderBooks(null, true)
        this.sonCoin = anaCoin
        this.islemdekiler.push(anaCoin)
        this.CheckForMainMarket(anaCoin, 'BTC', 'LTC')
        this.CheckForMainMarket(anaCoin, 'BTC', 'DOGE')
        this.CheckForMainMarket(anaCoin, 'LTC', 'BTC')
        this.CheckForMainMarket(anaCoin, 'LTC', 'DOGE')
        this.CheckForMainMarket(anaCoin, 'DOGE', 'LTC')
        this.CheckForMainMarket(anaCoin, 'DOGE', 'BTC')
        this.IslemdekilerCikar(anaCoin)
    }

    CheckForMainMarket(anaCoin, firstBase, secondBase){
        const findMarket = (marketName) =>{
            const market = this.ortak.depths[marketName]
            if(!market || !market.depths || !market.depths.bids || !market.depths.bids[0] || !market.depths.asks || !market.depths.asks[0]) return false
            const orderbook = {}
            orderbook.market = marketName
            orderbook.ask = this.SetBook(market.depths, 'asks', marketName)
            orderbook.bid = this.SetBook(market.depths, 'bids', marketName)
            return orderbook
        }
        
        const lenCoin = this.allCoins.length
        for (let i = 0; i < lenCoin; i++) {
            const coin = this.allCoins[i]
            const anaCoinLtc  = findMarket(anaCoin + '/' + firstBase)
            const anaCoinBtc  = findMarket(anaCoin + '/' + secondBase)
            const coinBtc     = findMarket(coin + '/'+ secondBase)
            const coinLtc     = findMarket(coin + '/' + firstBase)
            const testAmount  = 100
            
            if(!anaCoinLtc || !anaCoinBtc || !coinBtc || !coinLtc) continue

            // LTC > BTC
            const firstTotal  = anaCoinLtc.ask.price * testAmount  // LTC ile ada alıyorum
            const secondTotal = anaCoinBtc.bid.price * testAmount  // Adayi btc ye çeviriyorun- ada ile btc alıyorum
            const thirdTotal  = secondTotal / coinBtc.ask.price    // Btc ile etn alıyorum
            const lastTotal   = coinLtc.bid.price * thirdTotal     // etn yi ltc ye satıyorum yani ltc alıyorum

            const fark = (lastTotal - firstTotal) / firstTotal * 100 // ilk aldığım değerle son aldığım değeri karşılaştırıyorum.
            const checkTamUygun = anaCoinLtc.ask.total >= this.ortak.limits[firstBase] && anaCoinBtc.bid.total >= this.ortak.limits[secondBase] // CHECK TAM UYGUN
            const checkTamUygun2 = coinBtc.ask.total >= this.ortak.limits[secondBase] && coinLtc.bid.total >= this.ortak.limits[firstBase] // CHECK TAM UYGUN

            if(fark > 1){  // %1 den fazla fark varsa tamam.
                if(checkTamUygun && checkTamUygun2) {
                    this.FdbIslemleri(coin, anaCoinLtc, coinBtc, fark)
                    /*
                    this.ortak.db.ref(this.fdbRoot+"-uygunlar").child(coin).set({fark, coin, anaCoin, first: anaCoinLtc, second: anaCoinBtc, third: coinBtc, fourth: coinLtc})
                    console.log(`${anaCoin} coini > ${coin} coinine ${firstBase} > ${secondBase} ile çevirince fark: `+ fark)
                    */
                }
            }
        }
    }


    UygunMarketiGetir(altiTickers, coin){ // type ask yada bid.
        const {coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc} = altiTickers
        const uygunMarkets = []
        const markets = { btc: {ltc:{}, doge:{}}, ltc: {btc:{}, doge:{}}, doge:{btc:{}, ltc:{}} }
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
            markets[from][to].fark = fark
            from = from.replace(/^\w/, c => c.toUpperCase())
            to = to.replace(/^\w/, c => c.toUpperCase())
            const first = altiTickers['coin'+from]
            const second = altiTickers['coin'+to]
            this.FdbIslemleri(coin, first, second, fark)
            const checkTamUygun = first.ask.total >= this.ortak.limits[from.toUpperCase()] && second.bid.total >= this.ortak.limits[to.toUpperCase()] // CHECK TAM UYGUN
            if(!checkTamUygun) return
            console.log(coin + ` - ${from} > ${to} KOŞUL UYUYOR`)
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
