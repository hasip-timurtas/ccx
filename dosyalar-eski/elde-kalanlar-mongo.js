const MhtCcxt = require('../dll/mhtCcxt')
const rp = require('request-promise')
const mongodb = require('mongodb');

const firebase = require('firebase-admin');
const serviceAccount = require("../dll/firebase.json")
firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://firem-b3432.firebaseio.com"
});
const db = firebase.database();

const mongoUrl = "mongodb://209.250.238.100:27017/";

class EldeKalanCoinler {
    constructor(site){
        this.site = site
        // cry hasip4441
        /*
        const key = "aa903e0b70544955b414d33d987bfe2f"
        const secret = "8i3GoHxNRvCMticaKj++sBt4H2BI1WLUtVX6UsY1Ycs="
        */
         // test
        this.mainMarkets = ['BTC', 'LTC', 'DOGE']

         // abdullati56
        const key = "dbec90fd39294e1fa90db54e404c2edc"
        const secret = "D3tx+b8gb3Me2z3T/D/gzMdRWfNbR9vfYyf/RiqdJzc="
        this.ccx = new MhtCcxt(key, secret, site, null)
        this.limits = {"BTC": 0.0005, "ETH": 0.01, "LTC": 0.01, "DOGE": 100, "BNB":5, "USD":100, "USDT":100}
        this.db = db
    }
    
    async Basla(connection){ // baseCoin hangi coinle alacağı
        this.depths = connection.collection('depths')

        this.marketsInfos = await this.ccx.exchange.load_markets()
        /*
        Volume 0 olana koyma
        this.allMarkets = await this.ccx.GetMarkets()	
        this.allMarkets = this.allMarkets.Data
        */
        await this.GetBalance()
        const totalBalances = this.balances.filter(e=> e.Total > 0) // direk sell yapacağız.

        let openOrders = await this.db.ref(`Abritage-in-site/${this.site}-open-orders`).once('value').then(snapshot => snapshot.val())

        openOrders = openOrders && Object.keys(openOrders).map(e=> ({
                market: openOrders[e].market, 
                orderId: openOrders[e].orderId,
                price: openOrders[e].price,
                amount: openOrders[e].amount,
                total: openOrders[e].total
            })) // object to array

        await this.BalanceEsitle()





        for (const balance of totalBalances) {
            if(balance.Symbol=="SPANK"){
                this.dur = 1
            }
            if(this.mainMarkets.includes(balance.Symbol)) continue  // Ana market kontrolü

            if(balance.Total == balance.Available){
                await this.SellKur(balance)
            }else{
                this.balance = balance
                this.openOrder = openOrders && openOrders.find(e=> e.market.split('/')[0] == balance.Symbol)
    
                if(!this.openOrder) continue
                // buy kontrol
                //await this.BuyaKoyKontrol()
                await this.SelleKoyKontrol()
            }
        }
    }

    async SelleKoyKontrol(){
        // Daha iyi market var mı? varsa boz. ve o markette kur. 
        const dahaIyiMarketVar = await this.DahaIyiMarketVarmi(this.balance.Symbol)

        if(dahaIyiMarketVar){
            console.log('Daha iyi Market var!');
            await this.SellBoz(this.balance) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
            return
        }

        this.bizimTutarin3te1i = this.openOrder.total // 3te birini tamamı yaptık. / 3 * 1
        await this.GetOrderBook(this.openOrder.market) // bunu önce geçen kontrolü için alıyoruz. burda alıyoruz çünkü awaiti var.
        if(!this.marketOrders) return // mongo db de depths datası yoksa dön. 
        //const marketOrderPrice = this.marketOrder.Sell[0].Price
        const result = await this.OneGecenVarmiKontrolSell()

        // true ise pazarı boz.
        if(result){
            await this.SellBoz(this.balance) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
        }
    }


    async SellKur(balance){
        const market = await this.HangiMarketteEnPahali(balance.Symbol)
        if(!market) return
        const baseMarket = market.market.split('/')[1]
        this.SetPrices(market.market)
        const limit = this.limits[baseMarket]
        const totalSell = balance.Available * market.asks[0][0]
        //const totalBuy = balance.Available * market.sell
        if(totalSell < limit) return
        const sellPrice = market.asks[0][0]
        //const buyPrice = market.buy
        let newPrice = sellPrice - this.ondalikliSayi // -1 fiyatını belirliyoruz sell de en öne koymak için

        /*
        // Eğer koyacağımız sell fiyatı ile buy fiyatı arasında % 1 fark varsa. buydan ver gitsin aq.
        const buySellFarki = (newPrice - buyPrice) / buyPrice * 100
        if(buySellFarki <= 1 && totalBuy < limit){  // eğer buy ve sell arasında % 1 fark varsa buya sat. Tabi amount ta varsa.
            newPrice = buyPrice
        }
        */
        const total = (newPrice * balance.Available).toFixed(10)
        await this.Submit(market.market, newPrice, balance.Available, 'sell'  ).then(e=>{
            if(!e.id) return
            this.db.ref(`Abritage-in-site/${this.site}-open-orders`).child(market.market.replace('/','_')).set({
                orderId: e.id,
                market: e.symbol,
                price: e.price,
                amount: e.amount,
                total: total
            });
        }).catch(e=>console.log(e))
    }

    async DahaIyiMarketVarmi(coin){
        const market = await this.HangiMarketteEnPahali(coin)
        if(!market) return false
        return market.market != this.openOrder.market
    }

    async SellBoz(balance){
        await this.ccx.CancelTrade(this.openOrder.orderId, this.openOrder.market).then(async (e)=>{
            this.db.ref(`Abritage-in-site/${this.site}-open-orders`).child(this.openOrder.market.replace('/','_')).set(null)
            console.log(`${this.openOrder.market} Cancel edildi'`)
            balance.Available = this.openOrder.amount
            await this.SellKur(balance)
        }).catch(e => e=>console.log(e))
    }

    OneGecenVarmiKontrolSell() {
        const kacinciInfo = this.GetKacinci()

        // Bir satoshi kontrol
        const SellIlkVeIkinci1Satoshi = (kacinciInfo.ikinciSellPrice - this.openOrder.price).toFixed(10) > 0.00000001 && this.openOrder.amount == kacinciInfo.ilkSellTutar // -> ikinci kontrol: 
        if (this.marketOrders.asks[0][0] == this.openOrder.price && SellIlkVeIkinci1Satoshi) { // Eğer biz sell de en öndeysek ve bi arkamızdaki ile aramızda 1 satoshi fark yoksa boz  
            console.log(this.openOrder.market + ' bozuluyor. 1 satoshi kontrolü');
            return true
        }

        const ondekiTutarKontrolu = this.OndekiTutarKontrolu(kacinciInfo.sellSirasi)

        if(ondekiTutarKontrolu){
            console.log(this.openOrder.market + ' bozuluyor. Öndeki Tutar Kontrolü');
            return true
        }else{
            return false
        }
    }

    GetKacinci() {
        var result = { sellSirasi: 0, ilkSellTutar: 0, ikinciSellPrice: 0}

        var secilenSellPrice = this.marketOrders.asks.find(e => Number(e[0]) == this.openOrder.price.toFixed(10))
        result.sellSirasi = secilenSellPrice && this.marketOrders.asks.indexOf(secilenSellPrice) + 1
        result.ikinciSellPrice = Number(this.marketOrders.asks[1][0]) // ikinci sıradakinin buy price.. [1][1] olsaydı 2. sıradakinin amountu olurdu.
        result.ilkSellTutar = this.marketOrders.asks[0][1]
        result.ilkSellTutar = Number(result.ilkSellTutar).toFixed(10)

        return result
    }

    OndekiTutarKontrolu(sira){
        var ilkinTutari = this.marketOrders.asks[0][0] * this.marketOrders.asks[0][1]  // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkVeIkincininTutari = ilkinTutari + this.marketOrders.asks[1][0] * this.marketOrders.asks[1][1] // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkIkiVeUcuncununTutari = ilkVeIkincininTutari + this.marketOrders.asks[2][0] * this.marketOrders.asks[2][1]
        
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

    async Submit(marketName, rate, amount, type){
        const orderParams = [marketName, 'limit', type, amount, rate]

        const submitOrder = await this.ccx.exchange.createOrder(...orderParams).then(e=>{
            return e
        }).catch(e => {
           // this.db.ref(`Abritage-in-site/${this.site}-submitOrder-hatalar`).push().set(e);
            console.log(e)
        })

        if (submitOrder) {
            console.log(`${marketName} için  ${type} kuruldu.'`)
            return submitOrder
        } else {
            console.log(`${type} Kurarken Hata. market: ${marketName}`)
            return false
        }
    }

    async GetBesMarketTickers(coin){
        const marketler = [
            coin + "/" + this.mainMarkets[0], 
            coin + "/" + this.mainMarkets[1], 
            coin + "/" + this.mainMarkets[2], 
            this.mainMarkets[1] + "/" + this.mainMarkets[0], 
            this.mainMarkets[2] + "/" + this.mainMarkets[0]
        ]
        const orderBooks = await this.GetOrderBooks(marketler)

        return { 
            market1: orderBooks.find(e => e.market == marketler[0]),
            market2: orderBooks.find(e => e.market == marketler[1]),
            market3: orderBooks.find(e => e.market == marketler[2]),
            market4: orderBooks.find(e => e.market == marketler[3]),
            market5: orderBooks.find(e => e.market == marketler[4])
        }
    }

    async HangiMarketteEnPahali(coin){
        // marketler sırayla --> ADA/USDT, ADA/BTC, ADA/ETH ve BTC/USDT, ETH/USDT
        const { market1, market2, market3, market4, market5 } = await this.GetBesMarketTickers(coin)
        
        if(!market1) return false // eğer 1 market bile yoksa false dön, çünkü biz 3 markettede olanlarla iş yapıyoruz.

        const coinMarket2Total = this.GetMarketTotal(market2)  // ADA/BTC
        const coinMarket3Total = this.GetMarketTotal(market3)  // ADA/ETH
        

        market1.total = this.GetMarketTotal(market1)  // ADA/USDT  değeri  -> bu hesaplamayı bunda yapacağımız ana coin. diğerlerini buna çevireceğimizden bunu birşeye çevirmemize gerek yok.
        market2.total = market4.asks[0][0] * coinMarket2Total // BTC/USDT  değeri
        market3.total = market5.bids[0][0] * coinMarket3Total  // ETH/USDT  değeri
        // Hangisi büyük ? 
        const markets = [market1, market2, market3]

        /*
        Volume 0 olana koyma
        markets.sort((a,b)=> b.total - a.total)
        // Volumesi 0 sa 2. yada 3. yü seç
        let uygunMarket
        for (const market of markets) {
            const marketTicker = this.allMarkets.find(e=> e.Label == markets[0].market)
            if(marketTicker.Volume > 0){
                uygunMarket = market
                break
            }
        }
        return uygunMarket || false
        */
        
        const maxTotal = Math.max(...markets.map(e=>e.total))  // en büyük totali alıyoruz.

        const market = markets.find(e=> e.total == maxTotal)  // en büyük totale sahip olan marketi alıyoruz.
        return market || false
        
    }

    GetMarketTotal(market){
        if(!market) return 0
        const baseCoin = market.market.split('/')[1]
        const testAmount = 100
        this.SetPrices(market.market) // base market price giriyoruz ondalık sayı için
        let total = (market.asks[0][0] - this.ondalikliSayi) * testAmount // coin o markette varsa degerini, yoksa 0 yazsın.
        if(baseCoin == 'BTC' && market.asks[0][0] < 0.0000000021) return 0 // basecoin BTC ise ve price 21 satoshiden küçükse bunu geç. 0 döndür.
        return total
    }
    
    async GetBalance(){
        this.balances = await this.ccx.GetBalance().catch(e => console.log(e))
        if(!this.balances){
            return await this.GetBalance()
        }
        this.balances = this.balances.Data.filter(e=> e.Status == 'OK' )
    }

    async GetOrderBooks(marketler){
        let orderBooks = await this.depths.find( { 'market': { '$in': marketler } } ).toArray()
        orderBooks = orderBooks.map(e=> {
            e.depths.market = e.market
            return e.depths
        }) //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
        return orderBooks
    }

    async GetOrderBook(marketName){
        this.marketOrders = await this.depths.findOne({ market: marketName } )
        if(!this.marketOrders){
            return false // mongo db de kayıt yoksa false döndür.
        }
        this.marketOrders = this.marketOrders.depths
    }

    sleep (saniye) {
		return new Promise(resolve => setTimeout(resolve, saniye * 1000))
    }
    
    SetPrices(marketName){
        // BUNU Volume yüksek olan siteler için 0 olarak ayarlayabiliriz. mesela okex, binance
        switch (this.marketsInfos[marketName].precision.price) {
            case 1:
            this.ondalikliSayi = 0.1
                break
            case 2:
            this.ondalikliSayi = 0.01
                break
            case 3:
            this.ondalikliSayi = 0.001
                break
            case 4:
            this.ondalikliSayi = 0.0001
                break
            case 5:
            this.ondalikliSayi = 0.00001
                break
            case 6:
            this.ondalikliSayi = 0.000001
                break
            case 7:
            this.ondalikliSayi = 0.0000001
                break
            case 8:
            this.ondalikliSayi = 0.00000001
                break
            case 9:
            this.ondalikliSayi = 0.000000001
                break
            case 10:
            this.ondalikliSayi = 0.0000000001
                break
        }
    }

    async BuyaKoyKontrol(){
        // coinin alındığı market
        const history = await this.GetCoininAlindigiMarket(this.balance.Symbol)

        /*
            amacımız eğer aldığımız bu coinin herhangi bir markette buydan kâr lı bir şekilde satabiliyorsak direk satalım.
            - ne kadardan aldığımızı bulalım. btc değerinde
            - diğer marketlerde satarsak kaç btc eder bulup aldığımız ile kıyaslayalım
            - aldığımız fiyatın üstünde buy varsa satalım.
            - yoksa en kârlı markette sell de dursun.
        */

    }

    async GetCoininAlindigiMarket(coin){
        const histories = []
        let history1 = await this.GetTradeHistory(coin + '/BTC')
        history1 = history1.find(e => e.Type == 'Buy')
        let history2 = await this.GetTradeHistory(coin + '/LTC')
        history2 = history2.find(e => e.Type == 'Buy')
        let history3 = await this.GetTradeHistory(coin + '/DOGE')
        history3 = history3.find(e => e.Type == 'Buy')
    
        histories.push(history1, history2, history3)
        const newestBuy = histories.sort((a,b)=> new Date(b.DateTime)- new Date(a.DateTime))[0]
        return newestBuy

    }

    async GetTradeHistory(marketName){
        let orderHistory = await this.ccx.GetTradeHistory(marketName).catch(e => console.log('GetTradeHistory', e))
        if (!orderHistory) {
            return await this.GetTradeHistory(marketName)
        } else {
            return orderHistory.Data
        }
    }

    async HangiMarketteEnPahaliBuy(coin, history){
        await this.GetOrderBookGroup(coin)

        switch (history.Market.split('/')[1]) {
            case value:
                
                break;
        
            default:
                break;
        }
          /*
            amacımız eğer aldığımız bu coinin herhangi bir markette buydan kâr lı bir şekilde satabiliyorsak direk satalım.
            - ne kadardan aldığımızı bulalım. btc değerinde
            - diğer marketlerde satarsak kaç btc eder bulup aldığımız ile kıyaslayalım
            - aldığımız fiyatın üstünde buy varsa satalım.
            - yoksa en kârlı markette sell de dursun.

            -- ###
            - ilk önce aldığımız coinin btc değerini bulucaz.
            
        */

        const coiniAldigiMarket = history.Market.split('/')[1]

        // coin = ADA   adet= 1000
        const coinBtc = this.orderBooks.find(e => e.Market == coin + '_BTC')
        const coinLtc = this.orderBooks.find(e => e.Market == coin + '_LTC')
        const coinDoge = this.orderBooks.find(e => e.Market == coin + '_DOGE')
        const ltcBtc = this.orderBooks.find(e => e.Market == 'LTC_BTC')
        const dogeBtc = this.orderBooks.find(e => e.Market == 'DOGE_BTC')

        // DOGE ile 4778 CPN => 2787 DOGE

        // 4778 CPN = 0.00090601 BTC
        let btcDegeri = coinBtc ? coinBtc.Buy[0].Price * history.Amount : 0 // coin o markette varsa degerini, yoksa 0 yazsın.
        // 4778 ADA = 0.07453078 LTC
        const ltcDegeri = coinLtc ? coinLtc.Buy[0].Price * history.Amount : 0 // coin o markette varsa degerini, yoksa 0 yazsın.
        // 4778 ADA = 2400.99948411 DOGE
        const dogeDegeri = coinDoge ? coinDoge.Buy[0].Price * history.Amount : 0 // coin o markette varsa degerini, yoksa 0 yazsın.


        // 1.70611580 LTC = 0.01753121 BTC
        const ltcBtcDegeri = ltcBtc.Sell[0].Price * ltcDegeri
        // 45018.70466394 DOGE = 0.01752219 BTC
        const dogeBtcDegeri = dogeBtc.Buy[0].Price  * dogeDegeri// Doge için buy price alıyoruz yoksa hepsi doge çıkar buy-sell arasındaki farktan.



        // Hangisi büyük ?
        if(btcDegeri > ltcBtcDegeri && btcDegeri > dogeBtcDegeri){
            return coinBtc
        }else if(ltcBtcDegeri > btcDegeri && ltcBtcDegeri > dogeBtcDegeri){
            return coinLtc
        }else if (dogeBtcDegeri > btcDegeri && dogeBtcDegeri > ltcBtcDegeri){
            return coinDoge
        }else{
            return false
        }
    }

    async BalanceEsitle(){
        //const btcBalance = this.balances.find(e.Symbol == 'BTC').Available
        const ltcBalance = this.balances.find(e=> e.Symbol == 'LTC').Available
        const dogeBalance = this.balances.find(e=> e.Symbol == 'DOGE').Available
        this.SetPrices('LTC/BTC') //ondalikliSayi için BTC LTC DOGE aynı
        if(ltcBalance > 1 ){
            const satilacakBalance = ltcBalance - 1
            await this.GetOrderBook('LTC/BTC')
            const sellPrice = this.marketOrders.asks[0][0] - this.ondalikliSayi
            const total = sellPrice * satilacakBalance
            if(total < this.limits["BTC"]) return
            this.Submit('LTC/BTC', sellPrice, satilacakBalance, 'Sell')
        }

        if(dogeBalance > 100000 ){
            const satilacakBalance = dogeBalance - 100000
            await this.GetOrderBook('DOGE/LTC')
            const sellPrice = this.marketOrders.asks[0][0] - this.ondalikliSayi
            const total = sellPrice * satilacakBalance
            if(total < this.limits["LTC"]) return
            this.Submit('DOGE/LTC', sellPrice, satilacakBalance, 'Sell')
        }
    }

}

module.exports = EldeKalanCoinler


/*

Volume 0 olana koyma
let eldeKalanCoinler

Basla()
setInterval(()=> Basla(), 1000 * 60 * 60 * 2)

async function Basla() {
    eldeKalanCoinler = new EldeKalanCoinler('cryptopia')
    const connection = await mongodb.MongoClient.connect(mongoUrl, { useNewUrlParser: true });
    const cnn = connection.db('cry')
    while(true){
        await eldeKalanCoinler.Basla(cnn).catch(e=> console.log(e))
    }
}


*/

async function Basla() {
    var eldeKalanCoinler = new EldeKalanCoinler('cryptopia')
    const connection = await mongodb.MongoClient.connect(mongoUrl, { useNewUrlParser: true });
    const cnn = connection.db('cry')
    while(true){
        await eldeKalanCoinler.Basla(cnn).catch(e=> console.log(e))
    }
}

Basla()