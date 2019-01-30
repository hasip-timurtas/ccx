const Ortak = require('./ortak')
const rp = require('request-promise')
const waitTime = 5 // dakika

class SellKontrol {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables('MONGO')
        this.amount = 1000
        this.marginAmount = 2
        this.marketName = 'BTC/USD'
        this.lastPrice = null
        this.checkPositionAktif = false
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
            const quantity = Math.abs(position.size)

            const kacCarpiGeride = Math.round((quantity / this.amount) +1)
            const fazlaAlimVar = kacCarpiGeride == 3
            // POSİTİON YOKSA 2 TANE NORMAL ORDER AÇ şimdi yeni ordersları aç. Buy ve sell için -+ 5 dolardan açıcaz
            if(position.orderedType == 'sell'){ // eğer önceki işlem sell ise yeni açılan sell 2 katı daha arkada dursun
                //const price = position.orderPrice > position.ticker.last ? position.ticker.last - 1 : position.orderPrice
                await this.CreateOrder('buy', quantity + this.amount, position.orderPrice)//ticker.last - this.marginAmount) // 
                !fazlaAlimVar && await this.CreateOrder('sell', this.amount, position.sells[0] + this.marginAmount * kacCarpiGeride)
            }else if(position.orderedType == 'buy'){
                //const price = position.orderPrice < position.ticker.last ? position.ticker.last + 1 : position.orderPrice
                await this.CreateOrder('sell', quantity + this.amount, position.orderPrice)//ticker.last + this.marginAmount) // + quantity
                !fazlaAlimVar && await this.CreateOrder('buy', this.amount, position.buys[0] - this.marginAmount * kacCarpiGeride) // buy ise buy 2 katı arkada dursun + this.amount
            }
            
            
        }else{
            // POSİTİON YOKSA 2 TANE NORMAL ORDER AÇ şimdi yeni ordersları aç. Buy ve sell için -+ 5 dolardan açıcaz
            await this.CreateOrder('buy', this.amount, position.buys[0] - this.marginAmount)
            await this.CreateOrder('sell', this.amount, position.sells[0] + this.marginAmount)
        }
        
        
    }

    AniDususAniYukselis(){
        // ANİ DÜŞÜŞ ANİ YÜKSELİŞ
        const aniYulselis = this.lastPrice && position.ticker.last - this.lastPrice == 10
        const aniDusus = this.lastPrice && this.lastPrice - position.ticker.last == -10
        if(aniYulselis || aniDusus) return true// eğer ani düşüş ve ani yükseliş varsa open orders kurma şimdilik
        this.lastPrice = position.ticker.last
        return false
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
                orderPrice = orderPrice > sells[0].Price ? sells[1].Price : orderPrice
            }else{
                orderPrice = e.avgEntryPrice + this.marginAmount // ne kadara satacağım bilgisi eğer 3550 den aldıysam 3555 den satıcam. marginAmount 5$ ise
                orderPrice = parseInt(orderPrice)
                orderPrice = orderPrice < buys[0].Price ? buys[1].Price : orderPrice
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
                sellNowPrice: e.currentQty > 0 ? sells[1].Price : buys[1].Price // bir dahaki işlem yani yukarıdaki orderedType in tersini yaptık. almışsa yukarıda buy yazar, almış ve satacağı için burada sell yazar.
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
        if(position && position.entryPrice) {  //  Açık posizyon varsa
            
            const lastFilled = history.find(e=> e.execType == 'Trade')
            const sonFillKacSaatOnce = Math.abs(new Date() - new Date(lastFilled.transactTime)) / 36e5;
            this.checkPositionAktif = false // normal şartlardan bunu deaktif yap.
            if(sonFillKacSaatOnce >= 0.75){ // posizyon 1 saattir açıksa kapat
                //await this.ortak.BitmexCalcelAllOrders()
                const quantity = Math.abs(position.size)
                const positionOpenOrderType = position.orderedType == 'sell' ? 'buy' : 'sell'
                this.checkPositionAktif = true // check postion orderi açılacaksa bunu aktif etki normal kontrol yenisini açmasın.
                //const price = positionOpenOrderType == 'sell' ? position.ticker.last + 1 : position.ticker.last - 1 
                return await this.CreateOrder(positionOpenOrderType, quantity, position.sellNowPrice)
            }
            /*
            const openOrders = await this.GetOpenOrders()
            const positionOrder = openOrders.Data.find(e=> e.Type == positionOpenOrderType)
            const sonFillKacSaatOnce = Math.abs(new Date(history[0].transactTime) - new Date()) / 36e5;
            if(positionOrder && positionOrder.kacSaatOnce > 1 && sonFillKacSaatOnce > 1){ // posizyon 1 saattir açıksa kapat
                return await this.CreateOrder(positionOpenOrderType, quantity, position.ticker)
            }
            */
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

    investingSignal(){
    /*
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
    */  
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
- Close position olayı iptal edilece.
- Eğer buy yada sell yapmışsa ikincisinde sll yada buyu 2 kat yap.
- 

*/