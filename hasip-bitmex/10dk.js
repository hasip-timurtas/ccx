const Ortak = require('./ortak')
const waitTime = 15 // dakika

class SellKontrol {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables('MONGO')
        this.amount = 5000
        this.marginAmount = 0.5
        this.marketName = 'BTC/USD'
        this.kaldirac = 25
    }

    async Basla10Dakika(){
        this.yeniAmount = this.amount
        const position = await this.GetPositions()
        const kontrollerUygun = await this.KontrollerUygun(position)
        if(!kontrollerUygun) return
        await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
        
        const openPositionVar = position && position.entryPrice
        if(openPositionVar){
            const quantity = Math.abs(position.size)
            await this.CreateOrder(position.nextOrderType, quantity, position.orderPrice)// quantity + this.amount -> sattıktan sonra al
        }
        // BURAYA BALANCE KONTROL EKLENECEK
        await this.CreateOrder('buy', this.yeniAmount, position.buys[0].Price) 
        await this.CreateOrder('sell', this.yeniAmount, position.sells[0].Price)
    }

    async KontrollerUygun(position){
        // BALANCE KONTROL
        
        const balances = await this.ortak.GetBalance()
        const openOrdersBalance = this.amount / position.sells[0].Price / this.kaldirac
        const balance = balances.find(e=> e.Symbol == 'XBT')
        const balanceValid = balance.Available > openOrdersBalance
        if(!balanceValid){
            console.log('Balance yeterli değil, güncelleniyor.', new Date())
            this.yeniAmount = balance.Available * position.sells[0].Price * this.kaldirac
            this.yeniAmount = this.amount - (this.amount * 0.05)
            this.yeniAmount = parseInt(this.amount)
            if(this.amount < 100){
                console.log('Balance 100 den küçük o yüzden çıkılıyor.');
                return false
            }
            console.log('Yeni Balance: '+ this.yeniAmount);
        }
    
        // OPEN ORDERSLAR ÜSTTE
        const openOrders = await this.GetOpenOrders()
        let buyYadaSellUstte = false
        for (const openOrder of openOrders.Data) {
            if(openOrder.Rate == position.buys[0].Price){ // BUY
                buyYadaSellUstte = true
            }

            if(openOrder.Rate == position.sells[0].Price){ // SELL
                buyYadaSellUstte = true
            }
        }
       
        //const sellUstte = openOrders.sell && openOrders.sell.Rate == position.sells[0].Price
        if(buyYadaSellUstte){
            console.log('OpenOrder(s) üstte, yani sırada, işlem olacak. o yüzden çıkılıyor.', new Date())
            return false
        }

        return true // final
    }
    

    async GetPositions(){
        //const ticker =  await this.ortak.ccx.exchange.fetchTicker(this.marketName) // awaitthis.ortak.ccx.GetMarket(marketName)
        const orderBooks = await this.ortak.ccx.GetMarketOrders(this.marketName, 2)
        const sells = orderBooks.Data.Sell
        const buys = orderBooks.Data.Buy

        // Get Positions
        const result = JSON.parse(await this.ortak.BitmexPositions())
        const positions =  result && result[0].avgEntryPrice && result.map(e=>{
            const orderedType = e.currentQty < 0 ? 'sell' : 'buy' // size negatif ise sell yapılmış pozitif ise buy.
            const nextOrderType =  orderedType == 'sell' ? 'buy' : 'sell' // next order of the position
            let orderPrice
            
            if(orderedType == 'sell'){
                orderPrice = e.avgEntryPrice - this.marginAmount // ne kadara satacağım bilgisi eğer 3550 den aldıysam 3545 den satıcam. marginAmount 5$ ise
                const sayiSonu5Yada0 = ['0','5'].includes(orderPrice.toString().split(".")[1])
                orderPrice = sayiSonu5Yada0 ? orderPrice : parseInt(orderPrice)
                orderPrice = orderPrice > buys[0].Price ? buys[0].Price : orderPrice
            }else{
                orderPrice = e.avgEntryPrice + this.marginAmount // ne kadara satacağım bilgisi eğer 3550 den aldıysam 3555 den satıcam. marginAmount 5$ ise
                const sayiSonu5Yada0 = ['0','5'].includes(orderPrice.toString().split(".")[1])
                orderPrice = sayiSonu5Yada0 ? orderPrice : parseInt(orderPrice)
                orderPrice = orderPrice < sells[0].Price ? sells[0].Price : orderPrice
            }

            return {
                size: e.currentQty, 
                entryPrice: e.avgEntryPrice, 
                markPrice: e.markPrice, 
                //lastPrice: e.lastPrice, 
                liqPrice: e.liquidationPrice,
                orderedType,
                nextOrderType,
                orderPrice,
                //ticker,
                sells,
                buys,
                sellNowPrice: e.currentQty > 0 ? sells[0].Price : buys[0].Price // bir dahaki işlem yani yukarıdaki orderedType in tersini yaptık. almışsa yukarıda buy yazar, almış ve satacağı için burada sell yazar.
            }
        })[0]

        return positions || {buys, sells}

    }

    async CreateOrder(type, quantity, price, marketType = "limit"){
        const orderParams = ['BTC/USD', marketType, type, quantity, price]
        return await this.ortak.ccx.exchange.createOrder(...orderParams).catch(e => {
            console.log(e, 'BTC/USD')
        })
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

let sellKontrol

async function Basla(){
    sayac++
    sellKontrol = new SellKontrol()
    await sellKontrol.LoadVeriables()
    ReopenOrders()

}

async function ReopenOrders(){
    while(true){
        await sellKontrol.Basla10Dakika().catch(e=> console.log(e))
        await sellKontrol.ortak.sleep(60 * waitTime)
    }
}

Basla()
