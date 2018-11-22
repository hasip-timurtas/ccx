const Ortak = require('./ortak')

class WsMongo {
    async LoadVeriables() {
        this.islemKati = 15
        this.minFark = 1
        this.islemdekiler = []
        this.ortak = new Ortak()
        await this.ortak.LoadVeriables()
        //await this.ortak.LoadVeriables()
        setInterval(async ()=> await this.BalanceGuncelle(), 2000 )
        setInterval(()=> console.log('Son işlenen: ' + this.sonCoin), 5000 )
        this.balances = []
        this.oncekiCoin = null
        this.orderBookCount = 10
        this.subSayac = 0
        this.steamBasla = false
        this.sonCoin = '1'
        this.datalarString = []
    }

    cryWsBasla(){
        this.ortak.db.ref(`cry/min-max`).set(null)
        this.ortak.wsDepth.WsBaslat(coin=> this.SteamHandler(coin))
    }

    SteamHandler(coin){
        if(this.islemdekiler.includes(coin) || this.ortak.mainMarkets.includes(coin) || this.ortak.wsDataProcessing ) return
        this.MinMaxFunk(coin)
        //this.YesYeniFunk(coin)
    }

    async YesYeniFunk(coin){
        this.islemdekiler.push(coin)
        const result = this.GetMarketList(coin)
        let allMarkets = await this.ortak.GetOrderBooks(result.marketList)
        if(allMarkets.length != 6) return this.IslemdekilerCikar(coin)

        const data = this.ortak.OrderBooksDataKontrol(allMarkets)
        if(!data){
            console.log('Data uygun değil. ÇIK.')
            this.IslemdekilerCikar(coin)
            return
            allMarkets = await this.ortak.GetOrderBookGroupRest(coin)
        }
        const promises = []
        for (const item of result.listForFunction) {
            //const orderBooks = allMarkets.filter(e=> item.list.includes(e.market))
            promises.push(this.MarketGir(coin, ...item.list, item.type, allMarkets))
        }

        Promise.all(promises).then(e => this.IslemdekilerCikar(coin)).catch(e=> this.IslemdekilerCikarHataEkle(e, coin))
        //await this.GetEnUcuzVeEnPahaliMarket(coin)
        this.sonCoin = coin
    }

    async MarketGir(coin, firstMarketName, secondMarketName, thirdMarketName, btcMarketName, type, orderBooks ){
        //Volume kontrol
        const volumeUygun = this.ortak.marketTickers.Data.find(e=> e.Label == secondMarketName && e.Volume > 0.01)
        if(!volumeUygun) return
        const d = {coin, firstMarketName, secondMarketName, thirdMarketName, btcMarketName, type }
        const rob = await this.GetOrderBookGroup(d, orderBooks) // result order book yani rob
        if(!rob) return 
        const sonuc = this.Kontrol(d, rob)
        if(sonuc) await this.UygunMarketEkle(d, rob)
    }

    Kontrol(d, rob){
        const { firstOrderBook, secondOrderBook, thirdOrderBook, dogeLtcOrderBook, ltcBtcOrderBook } = rob
        const firstMainCoin = d.firstMarketName.split('/')[1]
        const secondMainCoin = d.secondMarketName.split('/')[1]
        const ourTotal = this.ortak.limits[firstMainCoin]
        const firstMarketAmount = ourTotal / firstOrderBook.price // first market amount' u aldık.
        if(!isFinite(firstMarketAmount)) return false // infinity ise çık

        const secondMarketTotal = firstMarketAmount * secondOrderBook.price // totalimizi aldık. second market total.
        let thirdMarketTotal = d.type == 'alt' ? secondMarketTotal / thirdOrderBook.price : secondMarketTotal * thirdOrderBook.price // alt ise böy, üst se çarp

        if(d.type == 'ust' && d.thirdMarketName == 'DOGE/BTC'){
            const dogeLtcTotal = dogeLtcOrderBook.price * secondMarketTotal
            const thirdMarketTotal2 = ltcBtcOrderBook.price * dogeLtcTotal 
            thirdMarketTotal = [thirdMarketTotal, thirdMarketTotal2].sort((a,b)=> b-a)[0] // hem doge>btc hemde doge>ltc>btc fiyatlarını alıyoruz hangisi büyükse onu alacak.
        }

        const kar = thirdMarketTotal - ourTotal // elde edilen doge ile 10.000 doge arasındaki farka bakıyor. kâr.
        const fark = kar / ourTotal * 100
        const sonuc = fark >= this.minFark
        const checkTamUygun = rob.firstOrderBook.total >= this.ortak.limits[firstMainCoin] && rob.secondOrderBook.total >= this.ortak.limits[secondMainCoin] // CHECK TAM UYGUN
        console.log(fark)
        //if(sonuc && !checkTamUygun) console.log(`Market: ${d.firstMarketName} >  ${d.secondMarketName} # Fark: % ${fark.toFixed(2)}`)
        return sonuc && checkTamUygun
    }

    async UygunMarketEkle(d, rob){
        const uygunMarket = {
            firstMarket:  { name: d.firstMarketName,  price: rob.firstOrderBook.price,  total: rob.firstOrderBook.total },
            secondMarket: { name: d.secondMarketName, price: rob.secondOrderBook.price, total: rob.secondOrderBook.total },
            //thirdMarket:  { name: d.thirdMarketName,  price: rob.thirdOrderBook.price,  total: rob.thirdOrderBook.total, type: d.type },
            btcMarket:    { name: d.btcMarketName,    price: rob.btcOrderBook.price,    total: rob.btcOrderBook.total }
        }

        //await this.BuySellBasla(uygunMarket)         
    }

    async GetOrderBookGroup(d, orderBooks){
        const kontrol = this.OrderBooksKontrol(orderBooks, d)
        if(!kontrol) return false
        const SetBook = (orderBook, type) => ({ price: Number(orderBook[type][0].rate), total: Number(orderBook[type][0].rate) * Number(orderBook[type][0].amount) })
        let { firstOrderBook, secondOrderBook, thirdOrderBook, btcOrderBook, dogeLtcOrderBook, ltcBtcOrderBook } = kontrol

        firstOrderBook = SetBook(firstOrderBook, 'asks') 
        secondOrderBook = SetBook(secondOrderBook, 'bids') 
        thirdOrderBook = d.type == 'alt' ? SetBook(thirdOrderBook, 'asks') : SetBook(thirdOrderBook, 'bids') 
        dogeLtcOrderBook = SetBook(dogeLtcOrderBook, 'bids')
        ltcBtcOrderBook = SetBook(ltcBtcOrderBook, 'bids')
        btcOrderBook = SetBook(btcOrderBook, 'asks')
        return {firstOrderBook, secondOrderBook, thirdOrderBook, btcOrderBook, dogeLtcOrderBook, ltcBtcOrderBook}
    }

    OrderBooksKontrol(orderBooks, d){
        // order 3 ten küçükse || orderbook boşsa || asks yoksa || bids yoksa || ask 1 satohi ise || sıfırıncı bid yoksa || bid 22 satoshhiden küçükse
        if(orderBooks.length < 3) return false
        for (const orderBook of orderBooks) {
            const sonuc = !orderBook || !orderBook.asks || !orderBook.asks[0] || orderBook.asks[0].rate == 0.00000001 || !orderBook.bids || !orderBook.bids[0] || orderBook.bids[0].rate < 0.00000022  
            if(sonuc) return false
        }

        const firstOrderBook = orderBooks.find(e=> e.market == d.firstMarketName)
        const secondOrderBook = orderBooks.find(e=> e.market == d.secondMarketName)
        const thirdOrderBook = orderBooks.find(e=> e.market == d.thirdMarketName)
        const btcOrderBook = orderBooks.find(e=> e.market == d.btcMarketName)
        const dogeLtcOrderBook = orderBooks.find(e=> e.market ==  'DOGE/LTC')
        const ltcBtcOrderBook = orderBooks.find(e=> e.market ==  'LTC/BTC')
        if(!btcOrderBook || !firstOrderBook || !secondOrderBook || !thirdOrderBook) return false

        return { firstOrderBook, secondOrderBook, thirdOrderBook, btcOrderBook, dogeLtcOrderBook, ltcBtcOrderBook }
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

    // #################        WEBSOCKET       #################

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

    GetMarketList(coin){
        const marketList = [
            coin + "/" + this.ortak.mainMarkets[0], // ADA/BTC
            coin + "/" + this.ortak.mainMarkets[1], // ADA/LTC
            coin + "/" + this.ortak.mainMarkets[2], // ADA/DOGE
            this.ortak.mainMarkets[1] + "/" + this.ortak.mainMarkets[0], // LTC/BTC
            this.ortak.mainMarkets[2] + "/" + this.ortak.mainMarkets[0], // DOGE/BTC
            this.ortak.mainMarkets[2] + "/" + this.ortak.mainMarkets[1]  // DOGE/LTC
        ]
        // marketList sırasıyla - > ADA/BTC - ADA/LTC - ADA/DOGE - LTC/BTC - DOGE/BTC - DOGE/LTC
        const listForFunction = [
            { list: [ marketList[0], marketList[1], marketList[3], marketList[0] ], type: 'ust' },   // ADA/BTC  - ADA/LTC  - LTC/BTC  - [ADA/BTC]
            { list: [ marketList[0], marketList[2], marketList[4], marketList[0] ], type: 'ust' },   // ADA/BTC  - ADA/DOGE - DOGE/BTC - [ADA/BTC]

            { list: [ marketList[1], marketList[0], marketList[3], marketList[0] ], type: 'alt' },   // ADA/LTC  - ADA/BTC  - LTC/BTC  - [ADA/BTC]
            { list: [ marketList[1], marketList[2], marketList[5], marketList[0] ], type: 'ust' },   // ADA/LTC  - ADA/DOGE - DOGE/LTC - [ADA/BTC]

            { list: [ marketList[2], marketList[0], marketList[4], marketList[0] ], type: 'alt' },   // ADA/DOGE - ADA/BTC  - DOGE/BTC - [ADA/BTC]
            { list: [ marketList[2], marketList[1], marketList[5], marketList[0] ], type: 'alt' },   // ADA/DOGE - ADA/LTC  - DOGE/LTC - [ADA/BTC]
        ]

        return { marketList, listForFunction }
    }

    async FdbIslemleri(coin, farkKontrol, data){
        const fdbName = enUcuzSell.market.replace('/','-') + '--' + enPahaliBuy.market.replace('/','-')
        if(!farkKontrol){
            return this.ortak.db.ref(`cry/min-max`).child(coin).child(fdbName).set(null)
        }
        const {enUcuzSell, enPahaliBuy, fark } = data
        const firstTotalUygun = enUcuzSell.ask.total >= this.ortak.limits[enUcuzSell.market.split('/')[1]]
        const secondTotalUygun = enPahaliBuy.bid.total >= this.ortak.limits[enPahaliBuy.market.split('/')[1]]
        const totalUygun = firstTotalUygun && secondTotalUygun
        const uygunMarket = {
            firstName: enUcuzSell.market,
            secondName: enPahaliBuy.market,
            firstMarket:  { price: enUcuzSell.ask.price.toFixed(8), amount: enUcuzSell.ask.amount.toFixed(8), total: enUcuzSell.ask.total.toFixed(8), totalUygun: firstTotalUygun  }, // TODO: tofixed kaldır.
            secondMarket: { price: enPahaliBuy.bid.price.toFixed(8), amount: enPahaliBuy.bid.amount.toFixed(8), total: enPahaliBuy.bid.total.toFixed(8), totalUygun: secondTotalUygun },// TODO: tofixed kaldır.
            totalUygun,
            fark: fark.toFixed(2)
        }

        if(this.datalarString[fdbName] != JSON.stringify(uygunMarket)){ // Datalar aynı değilse ise kaydet değilse tekrar kontrole git.
            this.datalarString[fdbName] = JSON.stringify(uygunMarket)
            await this.ortak.db.ref(`cry/min-max`).child(coin).child(fdbName).set(uygunMarket)
        }

        await this.ortak.sleep(10)
        this.MinMaxFunk(coin)
    }

    MinMaxFunk(coin){
        const sonuc = this.GetEnUcuzVeEnPahaliMarket(coin)
        if(!sonuc) return false
        
        const {enUcuzSell, enPahaliBuy, coinBtc, fark } = sonuc

        const uygunMarket = {
            firstMarket:  { name: enUcuzSell.market,  price: enUcuzSell.ask.price,  total: enUcuzSell.ask.total}, // TODO: tofixed kaldır.
            secondMarket: { name: enPahaliBuy.market, price: enPahaliBuy.bid.price, total: enPahaliBuy.bid.total},// TODO: tofixed kaldır.
            btcMarket:    { name: coinBtc.market,  price: coinBtc.ask.price,  total: coinBtc.ask.total},// TODO: tofixed kaldır.
        }
        this.ortak.mailDataMinMax.insertOne(uygunMarket)
        // BUY YAP kodu buraya ...
    }

    GetEnUcuzVeEnPahaliMarket(coin){ // mix max v2
        // marketler sırayla --> ADA/BTC, ADA/LTC, ADA/DOGE ve LTC/BTC, DOGE/BTC
        const altiTickers = this.ortak.GetAltiMarketTickers(coin)
        if(!altiTickers) return false
        const depthsKontrol = Object.keys(altiTickers).filter(e=> {
            const mrkt = altiTickers[e]
            // BURADA SADECE TEKLİ PRİCELERİ GİRİYORUZ birinci ask ve birinci bid gibi
            altiTickers[e].ask = {price: mrkt.asks[0].rate, amount: mrkt.asks[0].amount, total: mrkt.asks[0].rate * mrkt.asks[0].amount }
            altiTickers[e].bid = {price: mrkt.bids[0].rate, amount: mrkt.bids[0].amount, total: mrkt.bids[0].rate * mrkt.bids[0].amount }
            return !altiTickers[e] || !altiTickers[e].asks || !altiTickers[e].bids
        }) // herhangi biri boşsa veya asks veya bids i boşsa false true

        if(depthsKontrol > 0) return false // eğer 1 market bile yoksa ve depthleri yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.

        const enUcuzSell =  this.EnUcuzaSatanSell(altiTickers)
        const enPahaliBuy = this.EnPahaliyaAlanBuy(altiTickers)
        const coinBtc  = altiTickers["coinBtc"]

        if(!enUcuzSell || !enPahaliBuy) return false

        const firstBase = enPahaliBuy.market.split('/')[1]
        const secondBase = enUcuzSell.market.split('/')[1]
        const checkTamUygun = enPahaliBuy.total >= this.ortak.limits[firstBase] && enUcuzSell.total >= this.ortak.limits[secondBase] // CHECK TAM UYGUN
        const fark = (enPahaliBuy.testTotalPahali - enUcuzSell.testTotalUcuz) / enUcuzSell.testTotalUcuz * 100
        const farkKontrol = fark >= 1
        const data = { enPahaliBuy, enUcuzSell, coinBtc, fark }

        this.FdbIslemleri(coin, farkKontrol, data)// fark kontrol uygunsa db de data yı ekleyecek yada güncelleyecek değilse silecek. o yüzden buraya koyduk

        if(farkKontrol && checkTamUygun) return data // fark kontrol ile checktamuygunsa data döndürecek.
            
        return false
    }

    EnUcuzaSatanSell(altiTickers){ // SELL
        const {coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc} = altiTickers
        // marketler sırayla --> ADA/BTC, ADA/LTC, ADA/DOGE ve LTC/BTC, DOGE/BTC, DOGE/LTC
        const testAmount = 100
        const totalBtc = this.GetVatTotal(coinBtc.ask.price * testAmount, 'ask')  // ADA/BTC  ->  bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        const totalLtc = this.GetVatTotal(coinLtc.ask.price * testAmount, 'ask')  // ADA/LTC  ->  1000 ada x LTC yapar değeri. LTC değer
        const toalDoge = this.GetVatTotal(coinDoge.ask.price * testAmount, 'ask') // ADA/DOGE ->  1000 ada x Doge yapar değeri. DOGE değer  ### BUY çünkü doge de sell e bakarsak hepsinde doge çıkar.

        const ltcBtcTotal = this.GetVatTotal(ltcBtc.bid.price * totalLtc, 'bid')    // LTC/BTC  değeri, yukarıdaki totalLtc  nin BTC değeri
        const dogeBtcTotal = this.GetVatTotal(dogeBtc.bid.price * toalDoge, 'bid')  // DOGE/BTC değeri, yukarıdaki totalDoge nin BTC değeri.

        const dogeLtcTotal = this.GetVatTotal(dogeLtc.bid.price * toalDoge, 'bid')  // DOGE/LTC değeri, LTC doge karşılaştırması için sell alıyoruz. yukarıdaki toalDoge  nin LTC değeri.
        const dogeLtcBtcTotal = this.GetVatTotal(ltcBtc.bid.price * dogeLtcTotal, 'bid')  // DOGE/LTC nin LTC/BTC değeri , BTC değeri.
        
        coinBtc.testTotalUcuz = totalBtc
        coinLtc.testTotalUcuz = ltcBtcTotal 
        coinDoge.testTotalUcuz = [dogeBtcTotal, dogeLtcBtcTotal].sort((a,b)=> a - b)[0] // coin/doge -> doge/btc ve coin/doge -> doge/ltc -> ltc/btc var hangisi KÜÇÜKSE onu koyacak.

        const markets = [coinBtc, coinLtc, coinDoge]
        const vUygunlar = markets.filter(e=> this.ortak.marketTickers.Data.find(a=> a.Label == e.market && a.Volume > 0)) // Bu volumesi uygun marketleri alır.

        const uygunMarket = vUygunlar.sort((a,b)=> a.testTotalUcuz - b.testTotalUcuz)[0] // b-a büyükten küçüğe
        return uygunMarket
    }

    GetVatTotal(total, type){
        const yuzde = 0.002 // yüzde 0.2 yani 1000 de 2
        const vat = total * yuzde
        let netTotal
        if(type == 'bid'){
            netTotal = total + vat
        }else if(type =='ask'){
            netTotal = total - vat
        }else{
            throw 'GetTotal TYPE HATALI'
        }
       
        return netTotal
    }

    EnPahaliyaAlanBuy(altiTickers){ // BUY
        const {coinBtc, coinLtc, coinDoge, ltcBtc, dogeBtc, dogeLtc} = altiTickers
        const testAmount = 100
        // marketler sırayla --> ADA/BTC, ADA/LTC, ADA/DOGE ve LTC/BTC, DOGE/BTC, DOGE/LTC
        const totalBtc = this.GetVatTotal(coinBtc.bid.price * testAmount, 'bid')  // ADA/BTC  ->  bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        const totalLtc = this.GetVatTotal(coinLtc.bid.price * testAmount, 'bid') // ADA/LTC  ->  1000 ada x LTC yapar değeri. LTC değer
        const toalDoge = this.GetVatTotal(coinDoge.bid.price * testAmount, 'bid') // ADA/DOGE ->  1000 ada x Doge yapar değeri. DOGE değer  ### BUY çünkü doge de sell e bakarsak hepsinde doge çıkar.

        const ltcBtcTotal = this.GetVatTotal(ltcBtc.bid.price * totalLtc, 'bid')    // LTC/BTC  değeri, yukarıdaki totalLtc  nin BTC değeri
        const dogeBtcTotal = this.GetVatTotal(dogeBtc.bid.price * toalDoge, 'bid')  // DOGE/BTC değeri, yukarıdaki totalDoge nin BTC değeri.

        const dogeLtcTotal = this.GetVatTotal(dogeLtc.bid.price * toalDoge, 'bid')  // DOGE/LTC değeri, LTC doge karşılaştırması için sell alıyoruz. yukarıdaki toalDoge  nin LTC değeri.
        const dogeLtcBtcTotal = this.GetVatTotal(ltcBtc.bid.price * dogeLtcTotal, 'bid')  // DOGE/LTC nin LTC/BTC değeri , BTC değeri.
        
        coinBtc.testTotalPahali = totalBtc
        coinLtc.testTotalPahali = ltcBtcTotal 
        coinDoge.testTotalPahali = [dogeBtcTotal, dogeLtcBtcTotal].sort((a,b)=> b - a)[0] // coin/doge -> doge/btc ve coin/doge -> doge/ltc -> ltc/btc var hangisi BÜYÜKSE onu koyacak.

        const markets = [coinBtc, coinLtc, coinDoge]
        const vUygunlar = markets.filter(e=> this.ortak.marketTickers.Data.find(a=> a.Label == e.market && a.Volume > 0)) // Bu volumesi uygun marketleri alır.

        const uygunMarket = vUygunlar.sort((a,b)=> b.testTotalPahali - a.testTotalPahali)[0] // b-a büyükten küçüğe
        return uygunMarket
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
