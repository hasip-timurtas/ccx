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
        setInterval(async ()=> await this.BalanceGuncelle(), 3000 )
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
        //this.ortak.db.ref(this.fdbRoot).set(null)
        this.datalarString = []
        //this.AltcoinCheck('RDD')
        if(this.type == 'RAM' || this.type == 'ALTCOIN') this.ortak.wsDepth.WsBaslat(coin=> this.AltcoinCheck(coin))
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

    AltcoinCheck(anaCoin){
        if(this.islemdekiler.includes(anaCoin) || this.ortak.mainMarkets.includes(anaCoin) || this.ortak.wsDataProcessing || anaCoin.includes('$')) return
        //const orderBooks = await this.ortak.GetOrderBooks(null, true)
        this.sonCoin = anaCoin
        this.islemdekiler.push(anaCoin)
        const uygunMarkets = []
        uygunMarkets.push(this.CheckForMainMarket(anaCoin, 'BTC', 'LTC'))
        uygunMarkets.push(this.CheckForMainMarket(anaCoin, 'BTC', 'DOGE'))
        uygunMarkets.push(this.CheckForMainMarket(anaCoin, 'LTC', 'BTC'))
        uygunMarkets.push(this.CheckForMainMarket(anaCoin, 'LTC', 'DOGE'))
        uygunMarkets.push(this.CheckForMainMarket(anaCoin, 'DOGE', 'LTC'))
        uygunMarkets.push(this.CheckForMainMarket(anaCoin, 'DOGE', 'BTC'))

        if(uygunMarkets.length > 0){
            const uygunMarket = uygunMarkets.sort((a,b)=> b.fark - a.fark)[0]
            if(!uygunMarket) return this.IslemdekilerCikar(anaCoin)
            
            this.FdbIslemleri(uygunMarket)

            const checkTamUygun = uygunMarket.first.ask.total >= this.ortak.limits[uygunMarket.firstBase] && uygunMarket.second.bid.total >= this.ortak.limits[uygunMarket.secondBase] // CHECK TAM UYGUN
            const checkTamUygun2 = uygunMarket.third.ask.total >= this.ortak.limits[uygunMarket.secondBase] && uygunMarket.fourth.bid.total >= this.ortak.limits[uygunMarket.firstBase] // CHECK TAM UYGUN
            if(checkTamUygun && checkTamUygun2){
            
                this.ortak.db.ref(this.fdbRoot+"-uygunlar").child(coin).set(uygunMarket)
                console.log(`${anaCoin} coini > ${coin} coinine ${firstBase} > ${secondBase} ile çevirince fark: `+ fark)
                // BUYSELL BURAYA
            }

        }
        this.IslemdekilerCikar(anaCoin)
    }

    findMarket (marketName){
        const market = this.ortak.depths[marketName]
        if(!market || !market.depths || !market.depths.bids || !market.depths.bids[0] || !market.depths.asks || !market.depths.asks[0]) return false
        return {
            market: marketName,
            ask: this.SetBook(market.depths, 'asks', marketName),
            bid: this.SetBook(market.depths, 'bids', marketName)
        }
    }

    CheckForMainMarket(anaCoin, firstBase, secondBase){
        const lenCoin = this.allCoins.length
        const uygunMarkets = []
        for (let i = 0; i < lenCoin; i++) {
            const coin = this.allCoins[i]
            const anaCoinLtc  = this.findMarket(anaCoin + '/' + firstBase)
            const anaCoinBtc  = this.findMarket(anaCoin + '/' + secondBase)
            const coinBtc     = this.findMarket(coin + '/'+ secondBase)
            const coinLtc     = this.findMarket(coin + '/' + firstBase)
            const testAmount  = 100
            
            if(!anaCoinLtc || !anaCoinBtc || !coinBtc || !coinLtc) continue

            // LTC > BTC
            const firstTotal  = anaCoinLtc.ask.price * testAmount  // LTC ile ada alıyorum
            const secondTotal = anaCoinBtc.bid.price * testAmount  // Adayi btc ye çeviriyorun- ada ile btc alıyorum
            const thirdTotal  = secondTotal / coinBtc.ask.price    // Btc ile etn alıyorum
            const lastTotal   = coinLtc.bid.price * thirdTotal     // etn yi ltc ye satıyorum yani ltc alıyorum

            const fark = (lastTotal - firstTotal) / firstTotal * 100 // ilk aldığım değerle son aldığım değeri karşılaştırıyorum.

            if(fark > 2){  // %1 den fazla fark varsa tamam.
                const uygunMarket = {firstBase, secondBase, fark, coin, anaCoin, first: anaCoinLtc, second: anaCoinBtc, third: coinBtc, fourth: coinLtc}
                uygunMarkets.push(uygunMarket)
            }
        }

        return uygunMarkets.sort((a,b)=> b.fark - a.fark)[0] || false
    }

    FdbIslemleri(data){
        const {fark, anaCoin, coin, first, second, third, fourth} = data
        const firstTotalUygun = first.ask.total >= this.ortak.limits[first.market.split('/')[1]]
        const secondTotalUygun = second.bid.total >= this.ortak.limits[second.market.split('/')[1]]
        const thirdTotalUygun = third.ask.total >= this.ortak.limits[third.market.split('/')[1]]
        const fourthTotalUygun = fourth.bid.total >= this.ortak.limits[fourth.market.split('/')[1]]
        const totalUygun = firstTotalUygun && secondTotalUygun && thirdTotalUygun && fourthTotalUygun
        const uygunMarket = {
            anaCoin,
            coin,
            firstName: first.market,
            secondName: second.market,
            thirdName: third.market,
            fourthName: fourth.market,
            firstMarket:  { price: first.ask.price.toFixed(8), amount: first.ask.amount.toFixed(8), total: first.ask.total.toFixed(8), totalUygun: firstTotalUygun  }, 
            secondMarket: { price: second.bid.price.toFixed(8), amount: second.bid.amount.toFixed(8), total: second.bid.total.toFixed(8), totalUygun: secondTotalUygun },
            thirdrMarket: { price: third.ask.price.toFixed(8), amount: third.ask.amount.toFixed(8), total: third.ask.total.toFixed(8), totalUygun:  thirdTotalUygun},
            fourthMarket: { price: fourth.bid.price.toFixed(8), amount: fourth.bid.amount.toFixed(8), total: fourth.bid.total.toFixed(8), totalUygun:  fourthTotalUygun},
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
    await cryBuy.LoadVeriables()
    cryBuy.ortak.wsZamanlayici = 10 // dakika
    cryBuy.cryWsBasla()
    
    while(cryBuy.ortak.wsDataProcessing){
        await cryBuy.ortak.sleep(1)
    }
    console.log('Sayaç Çalışma süresi: ' + sayac)
}

Basla()
