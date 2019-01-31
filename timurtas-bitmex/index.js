const Ortak = require('./ortak')
const rp = require('request-promise')
const waitTime = 5 // dakika

class SellKontrol {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables('MONGO')
        this.amount = 10000
        this.marginAmount = 2
        this.marketName = 'BTC/USD'
        this.lastPrice = null
        this.checkPositionAktif = false
        this.orderType = {
            BUY: 1,
            DIRAKBUY: 2,
            SELL: 3,
            DIREKSELL: 4,
            BUYSELL: 5
        }
    }

    async BitmexBasla(){
        if(this.checkPositionAktif) return
        //const balances = await this.ortak.GetBalance()
        const openOrders = await this.GetOpenOrders()
        const openBuyVeSellVar = openOrders.buy && openOrders.sell
        if(openBuyVeSellVar) return

        await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
        const position = await this.GetPositions()
        const openPositionVar = position && position.entryPrice
        // Positionlarda kâr varsa sat.
        if(openPositionVar) {
            position.orderedType == 'sell' && this.SellYaptiBuyYap(position)
            position.orderedType == 'buy' && this.BuyYaptiSellYap(position)
        }else{
           this.OrderYokBuySellYap(position) // price bilgisi bunun içinde
        }
    }

    async OrderYokBuySellYap(position){
        const result = await this.GetOHLCV(position.buys[0].Price)
        switch (result) {
            case this.orderType.BUY: // test için tam tersini yapıyoruz. çok sell varsa sell yap.
                return await this.CreateOrder('buy', this.amount, position.buys[0].Price)
            case this.orderType.SELL: // test için tam tersini yapıyoruz. çok buy varsa buy yap.
                return await this.CreateOrder('sell', this.amount, position.sells[0].Price)
            case this.orderType.BUYSELL:
                await this.CreateOrder('buy', this.amount, position.buys[0].Price - this.marginAmount) // fiyat normal buy-sell yap
                await this.CreateOrder('sell', this.amount, position.sells[0].Price + this.marginAmount)
            default:
                console.log("OrderYokBuySellYap hatalı switch değeri. Değer: "+ result)
                break;
        }
        
    }

    async SellYaptiBuyYap(position){
        const quantity = Math.abs(position.size)
        const kacCarpiGeride = Math.round((quantity / this.amount) +1)
        const fazlaAlimVar = kacCarpiGeride == 3

        await this.CreateOrder('buy', quantity, position.orderPrice)// quantity + this.amount -> sattıktan sonra al
        !fazlaAlimVar && await this.CreateOrder('sell', this.amount, position.sells[0].Price + this.marginAmount * kacCarpiGeride)
    }

    async BuyYaptiSellYap(position){
        const quantity = Math.abs(position.size)
        const kacCarpiGeride = Math.round((quantity / this.amount) +1)
        const fazlaAlimVar = kacCarpiGeride == 3

        await this.CreateOrder('sell', quantity, position.orderPrice)// quantity + this.amount -> sattıktan sonra al 
        !fazlaAlimVar && await this.CreateOrder('buy', this.amount, position.buys[0].Price - this.marginAmount * kacCarpiGeride) // buy ise buy 2 katı arkada dursun + this.amount
    }



    async GetOHLCV(price){
        const oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1500) // 1,5 saat öncesi
        let grafiks = await this.ortak.ccx.exchange.fetchOHLCV(this.marketName, '5m', oneHourAgo)
        grafiks = grafiks.map(e=> ({date: new Date(e[0]), open: e[1], high: e[2], low: e[3], close: e[4], volume: e[5]}))

        const low = grafiks.map(e=> e.low).sort((a,b)=> a-b)[0]
        const high = grafiks.map(e=> e.high).sort((a,b)=> b-a)[0]
        const fark = high - low
        const farkYuzde20 = fark / 5 // %20 fark hesaplama için 5'e böldük
        const lowVe20 = low + farkYuzde20
        const highVe20 = high - farkYuzde20

        if(price < lowVe20){
            // Price çok düküş buy yap.
            return this.orderType.BUY
        }else if(price > highVe20){
            // Price Çok Düşük sell yap
            return this.orderType.SELL
        }else{
            // price normal buy ve sell yap
            return this.orderType.BUYSELL
        }
    }

    async GetPositions(){
        //const ticker =  await this.ortak.ccx.exchange.fetchTicker(this.marketName) // awaitthis.ortak.ccx.GetMarket(marketName)
        const orderBooks = await this.ortak.ccx.GetMarketOrders(this.marketName, 2)
        const sells = orderBooks.Data.Sell
        const buys = orderBooks.Data.Buy

        // Get Positions
        const result = JSON.parse(await this.ortak.BitmexPositions())
        return result && result.map(e=>{
            const orderedType = e.currentQty < 0 ? 'sell' : 'buy' // size negatif ise sell yapılmış pozitif ise buy.
            let orderPrice
            if(orderedType == 'sell'){
                orderPrice = e.avgEntryPrice - this.marginAmount // ne kadara satacağım bilgisi eğer 3550 den aldıysam 3545 den satıcam. marginAmount 5$ ise
                orderPrice = parseInt(orderPrice)
                orderPrice = orderPrice > buys[0].Price ? buys[0].Price : orderPrice
            }else{
                orderPrice = e.avgEntryPrice + this.marginAmount // ne kadara satacağım bilgisi eğer 3550 den aldıysam 3555 den satıcam. marginAmount 5$ ise
                orderPrice = parseInt(orderPrice)
                orderPrice = orderPrice < sells[0].Price ? sells[0].Price : orderPrice
            }

            return {
                size: e.currentQty, 
                entryPrice: e.avgEntryPrice, 
                markPrice: e.markPrice, 
                lastPrice: e.lastPrice, 
                liqPrice: e.liquidationPrice,
                orderedType,
                orderPrice,
                //ticker,
                sells,
                buys,
                sellNowPrice: e.currentQty > 0 ? sells[0].Price : buys[0].Price // bir dahaki işlem yani yukarıdaki orderedType in tersini yaptık. almışsa yukarıda buy yazar, almış ve satacağı için burada sell yazar.
            }
        })[0]
    }

    async CreateOrder(type, quantity, price, marketType = "limit"){
        const orderParams = ['BTC/USD', marketType, type, quantity, price]
        return await this.ortak.ccx.exchange.createOrder(...orderParams).catch(e => {
            console.log(e, 'BTC/USD')
        })
    }

    async CheckPositions(){
        const history = JSON.parse(await this.ortak.BitmexHistory())
        const position = await this.GetPositions()
        this.checkPositionAktif = false // normal şartlardan bunu deaktif yap.
        if(position && position.entryPrice) {  //  Açık posizyon varsa
            
            const lastFilled = history.find(e=> e.execType == 'Trade')
            const sonFillKacSaatOnce = Math.abs(new Date() - new Date(lastFilled.transactTime)) / 36e5;
            if(sonFillKacSaatOnce >= 0.75){ // posizyon 1 saattir açıksa kapat
                await this.ortak.BitmexCalcelAllOrders()
                const quantity = Math.abs(position.size)
                const positionOpenOrderType = position.orderedType == 'sell' ? 'buy' : 'sell'
                this.checkPositionAktif = true // check postion orderi açılacaksa bunu aktif etki normal kontrol yenisini açmasın.
                //const price = positionOpenOrderType == 'sell' ? position.ticker.last + 1 : position.ticker.last - 1 
                return await this.CreateOrder(positionOpenOrderType, quantity, position.sellNowPrice)
            }
        }
    }

    async GetOpenOrders(){
        const openOrders = await this.ortak.ccx.GetOpenOrders(this.marketName)
        openOrders.buy = openOrders.Data.find(e=> e.Type == 'buy') 
        openOrders.sell = openOrders.Data.find(e=> e.Type == 'sell') 

        for (const openOrder of openOrders.Data) {
            openOrder.kacSaatOnce = Math.abs(new Date(openOrder.entryDate) - new Date()) / 36e5;
        }

        return openOrders
    }

}



module.exports = SellKontrol

let sayac = 0
let sellKontrol

async function Basla(){
    sayac++
    sellKontrol = new SellKontrol()
    await sellKontrol.LoadVeriables()
    ReopenOrders()
    CheckPositions()
}

async function ReopenOrders(){
    while(true){
        await sellKontrol.BitmexBasla().catch(e=> console.log(e))
        await sellKontrol.ortak.sleep(60 * waitTime)
    }
}

async function CheckPositions(){
    while(true){
        await sellKontrol.CheckPositions()
        await sellKontrol.ortak.sleep(60 * waitTime * 2)
    }
}

Basla()

/*
    investingSignal(){
    
        const options = {
            method: 'POST',
            uri: 'https://tr.investing.com/instruments/Service/GetTechincalData',
            body: {
                pairID: '1057995',
                period: '300',
                viewType: 'normal'
            },
            json: true, // Automatically stringifies the body to JSON
            headers:{
                //'Content-Type': 'application/json'
                'User-Agent': 'Request-Promise',
                'Host': 'tr.investing.com',
                'Origin': 'https://tr.investing.com',
                'Referer': 'https://tr.investing.com/crypto/bitcoin/btc-usd-technical?cid=1057995'
              }
        }

        const sonuc = await rp(options).catch(e=> console.log(e))
    
    }
    
    AniDususAniYukselis(){
        // ANİ DÜŞÜŞ ANİ YÜKSELİŞ
        const aniYulselis = this.lastPrice && position.ticker.last - this.lastPrice == 10
        const aniDusus = this.lastPrice && this.lastPrice - position.ticker.last == -10
        if(aniYulselis || aniDusus) return true// eğer ani düşüş ve ani yükseliş varsa open orders kurma şimdilik
        this.lastPrice = position.ticker.last
        return false
    }

    async ClosePositions(){  // KULLANIM DIŞI
        // const history = JSON.parse(await this.ortak.BitmexHistory())
        
        const position = await this.GetPositions()
        
        // Positionlarda kâr varsa sat.
        if(position.entryPrice) {  //  Açık posizyon varsa
            // position var ve en az %1 karda
            const type = position.orderedType == 'sell' ? 'buy' : 'sell' // sell yapmışsa buy yapıcaz. değilse tam tersi.
            const quantity = Math.abs(position.size) // amount için size nigatif ise pozitif yap

            //await this.CreateOrder(type, quantity, position.orderPrice, 'market') // open positionu direk satıyoruz.  -- AMA market ile satıyoruz. 3 kat daha fazla fee var.
            await this.CreateOrder(type, quantity, position.ticker) // open positionu direk satıyoruz.  -- AMA market ile satıyoruz. 3 kat daha fazla fee var.
        
        }
    }
*/