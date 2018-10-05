const MhtCcxt = require('../dll/mhtCcxt')
const rp = require('request-promise')

const firebase = require('firebase-admin');
const serviceAccount = require("../dll/firebase.json")
firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://firem-b3432.firebaseio.com"
});
const db = firebase.database();

class EldeKalanCoinler {
    constructor(site){
        this.site = site
        // cry hasip4441
        /*
        const key = "aa903e0b70544955b414d33d987bfe2f"
        const secret = "8i3GoHxNRvCMticaKj++sBt4H2BI1WLUtVX6UsY1Ycs="
        */
        this.mainMarkets = ['BTC', 'LTC', 'DOGE']
         // abdullati56
        const key = "dbec90fd39294e1fa90db54e404c2edc"
        const secret = "D3tx+b8gb3Me2z3T/D/gzMdRWfNbR9vfYyf/RiqdJzc="
        this.ccx = new MhtCcxt(key, secret, site, null)
        this.limits = {"BTC": 0.0005, "ETH": 0.01, "LTC": 0.01, "DOGE": 100, "BNB":5, "USD":100, "USDT":100}
        this.db = db
    }
    
    async Basla(){ // baseCoin hangi coinle alacağı
        await this.GetBalance()
        const totalBalances = this.balances.filter(e=> e.Total > 0) // direk sell yapacağız.
        let openOrders = await this.db.ref(`Abritage-in-site/${this.site}-open-orders`).once('value').then(snapshot => snapshot.val())
        this.marketsInfos = await this.ccx.exchange.load_markets()

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
        const marketName = this.openOrder.market.replace('/','_')
        await this.GetOrderBook(marketName) // bunu önce geçen kontrolü için alıyoruz. burda alıyoruz çünkü awaiti var.
        //const marketOrderPrice = this.marketOrder.Sell[0].Price
        const result = await this.OneGecenVarmiKontrolSell()

        // true ise pazarı boz.
        if(result){
            await this.SellBoz(this.balance) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
        }
    }

    async SellKur(balance){
        const market = await this.HangiMarketteEnPahali(balance.Symbol)
        const baseMarket = market.Market.split('_')[1]
        this.SetPrices(market.Market.replace('_','/'))
        const limit = this.limits[baseMarket]
        const totalSell = balance.Available * market.Sell[0].Price
        const totalBuy = balance.Available * market.Sell[0].Price
        if(totalSell < limit) return
        const sellPrice = market.Sell[0].Price
        const buyPrice = market.Buy[0].Price
        let newPrice = sellPrice - this.ondalikliSayi // -1 fiyatını belirliyoruz sell de en öne koymak için

        /*
        // Eğer koyacağımız sell fiyatı ile buy fiyatı arasında % 1 fark varsa. buydan ver gitsin aq.
        const buySellFarki = (newPrice - buyPrice) / buyPrice * 100
        if(buySellFarki <= 1 && totalBuy < limit){  // eğer buy ve sell arasında % 1 fark varsa buya sat. Tabi amount ta varsa.
            newPrice = buyPrice
        }
        */
        const total = (newPrice * balance.Available).toFixed(10)
        await this.Submit(market.Market.replace('_','/'), newPrice, balance.Available, 'sell'  ).then(e=>{
            if(!e.id) return
            this.db.ref(`Abritage-in-site/${this.site}-open-orders`).child(market.Market.replace('/','_')).set({
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
        return market.Market != this.openOrder.market.replace('/','_')
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
        if (this.marketOrders.Sell[0].Price == this.openOrder.price && SellIlkVeIkinci1Satoshi) { // Eğer biz sell de en öndeysek ve bi arkamızdaki ile aramızda 1 satoshi fark yoksa boz  
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

        var secilenSellPrice = this.marketOrders.Sell.find(e => Number(e.Price) == this.openOrder.price)
        result.sellSirasi = secilenSellPrice && this.marketOrders.Sell.indexOf(secilenSellPrice) + 1
        result.ikinciSellPrice = Number(this.marketOrders.Sell[1].Price) // ikinci sıradakinin buy price.. [1][1] olsaydı 2. sıradakinin amountu olurdu.
        result.ilkSellTutar = this.marketOrders.Sell[0].Total / this.marketOrders.Sell[0].Price
        result.ilkSellTutar = Number(result.ilkSellTutar).toFixed(10)

        return result
    }

    OndekiTutarKontrolu(sira){
        var ilkinTutari = this.marketOrders.Sell[0].Total // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkVeIkincininTutari = ilkinTutari + this.marketOrders.Sell[1].Total // Burası 1. sıradaki buy un tutarı yani kaç dogelik pazar kurmuş eğerki 1000 dogenin altındaysa önüne geçme
        var ilkIkiVeUcuncununTutari = ilkVeIkincininTutari + this.marketOrders.Sell[2].Total
        
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

    async HangiMarketteEnPahali(coin){
        await this.GetOrderBookGroup(coin)
        // coin = ADA   adet= 1000
        const coinBtc = this.orderBooks.find(e => e.Market == coin + '_BTC')
        const coinLtc = this.orderBooks.find(e => e.Market == coin + '_LTC')
        const coinDoge = this.orderBooks.find(e => e.Market == coin + '_DOGE')
        const ltcBtc = this.orderBooks.find(e => e.Market == 'LTC_BTC')
        const dogeBtc = this.orderBooks.find(e => e.Market == 'DOGE_BTC')
        
        // 1000 ADA = 0.01715424 BTC
        this.SetPrices(coin + '/BTC')
        let btcDegeri = coinBtc ? (coinBtc.Sell[0].Price - this.ondalikliSayi) * 1000 : 0 // coin o markette varsa degerini, yoksa 0 yazsın.
        if(coinBtc && coinBtc.Sell[0].Price <= 0.00000021) btcDegeri = 0 // eğer coinin btc marketindeki sell price 21 satoshiden küçükse ise diğer markete geçsin.
        // 1000 ADA = 1.70611542 LTC
        this.SetPrices(coin + '/LTC')
        const ltcDegeri = coinLtc ? (coinLtc.Sell[0].Price - this.ondalikliSayi) * 1000 : 0 // coin o markette varsa degerini, yoksa 0 yazsın.
        // 1.70611580 LTC = 0.01753121 BTC
        const ltcBtcDegeri = ltcBtc.Sell[0].Price * ltcDegeri
        // 1000 ADA = 45018.70466394 DOGE
        this.SetPrices(coin + '/DOGE')
        const dogeDegeri = coinDoge ? (coinDoge.Sell[0].Price - this.ondalikliSayi) * 1000 : 0 // coin o markette varsa degerini, yoksa 0 yazsın.
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
    
    async GetBalance(){
        this.balances = await this.ccx.GetBalance().catch(e => console.log(e))
        if(!this.balances){
            return await this.GetBalance()
        }
        this.balances = this.balances.Data.filter(e=> e.Status == 'OK' )
    }

    async GetOrderBookGroup(coin){
        const marketler = coin + "_BTC-" + coin + "_LTC-"+ coin + "_DOGE-" + "DOGE_BTC-LTC_BTC"
        const fullUrl = `https://www.cryptopia.co.nz/api/GetMarketOrderGroups/${marketler}/1`
        const result = await rp(fullUrl).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(!result) return await this.GetOrderBookGroup(coin);
        if(result.length < 3 ) return false

        this.orderBooks = result.Data     
    }

    async GetOrderBook(marketName){
        const fullUrl = `https://www.cryptopia.co.nz/api/GetMarketOrders/${marketName}`
        const result = await rp(fullUrl).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(!result) return await this.GetOrderBook(marketName);
        this.marketOrders = result.Data     
    }

    sleep (saniye) {
		return new Promise(resolve => setTimeout(resolve, saniye * 1000))
    }

    SetPrices(marketName){
        if(!this.marketsInfos[marketName]) return
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
    
    async BalanceEsitle(){
        //const btcBalance = this.balances.find(e.Symbol == 'BTC').Available
        const ltcBalance = this.balances.find(e=> e.Symbol == 'LTC').Available
        const dogeBalance = this.balances.find(e=> e.Symbol == 'DOGE').Available
        this.SetPrices('LTC/BTC') //ondalikliSayi için BTC LTC DOGE aynı
        if(ltcBalance > 1 ){
            const satilacakBalance = ltcBalance - 1
            await this.GetOrderBook('LTC_BTC')
            const sellPrice = this.marketOrders.Sell[0].Price - this.ondalikliSayi

            this.Submit('LTC/BTC', sellPrice, satilacakBalance, 'Sell')
        }

        if(dogeBalance > 25000 ){
            const satilacakBalance = dogeBalance - 25000
            await this.GetOrderBook('DOGE_LTC')
            const sellPrice = this.marketOrders.Sell[0].Price - this.ondalikliSayi
            this.Submit('DOGE/LTC', sellPrice, satilacakBalance, 'Sell')
        }
    }

}

module.exports = EldeKalanCoinler

async function Basla() {
    var eldeKalanCoinler = new EldeKalanCoinler('cryptopia')
    while(true){
        await eldeKalanCoinler.Basla().catch(e=> console.log(e))
    }
}

Basla()
