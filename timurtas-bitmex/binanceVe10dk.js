const Ortak = require('./ortak')
const waitTime = 1 // dakika
const Binance = require('binance-api-node').default
const BitMEXClient = require('bitmex-realtime-api')

const binance = Binance()
const bitmexOptions = {
    testnet: false, // set `true` to connect to the testnet site (testnet.bitmex.com)
    apiKeyID: "WUi67Xl7EjE6A0iUq1RFVENw", // timurtas.hasip canlı
    apiKeySecret: "9alw1YOYGOlMrvW6N6AEC5ulmUl9ZKIP4a2RSdCQvs_xQCCn",
    maxTableLen: 10000  // the maximum number of table elements to keep in memory (FIFO queue)
  }

const bitmex = new BitMEXClient(bitmexOptions)

const markets = { BINANCE: 0, BITMEX: 1 }
const OrderType = { SELL: 'sell', BUY: 'buy' }
const FiyatType = { DUSTU: 'Fiyat DÜŞTÜ', CIKTI: 'Fiyat ÇIKTI' }

class SellKontrol {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables('MONGO')
        this.amount = 100
        this.marginAmount = 0.5
        this.marketName = 'BTC/USD'
        this.kaldirac = 25
        // BİNANCE
        this.binanceLastPrice = null
        this.binancePrice = null
        this.binancePriceList = []
        // BİTMEX
        this.bitmexLastPrice = null
        this.bitmexPrice = null
        this.bitmexPriceList = []
        this.binanceFark = 2
        this.loglama = false
        this.lastOrderDate = new Date()
        this.sonIslemBeklemeSuresi = 5 // saniye
        // WEBSOCKET
        this.position = null
        this.orderBooks = null
        this.openOrders = {Data: []}
        

    }

    async Basla(){
        console.log('Web socket dataları hazırlanıyor...');
        this.StartWsData()
        await this.ortak.sleep(10)
        console.log('Web socket dataları hazır.');
        this.PositionKontrol()
        this.OnDakika()
        this.BinanceBasla()
        
    }

    async StartWsData(){
        bitmex.addStream('XBTUSD', 'order', (data, symbol, tableName) => {
            this.GetOpenOrders(data)
        })

        await this.ortak.sleep(4)

        bitmex.addStream('XBTUSD', 'orderBook10', (data, symbol, tableName) => {
            this.orderBooks = data[data.length - 1]
        })

        await this.ortak.sleep(4)

        bitmex.addStream('XBTUSD', 'position', (data, symbol, tableName) => {
            this.GetPositions(data)
        })
    }

    async OnDakika(){
        while(true){
            await this.Basla10Dakika().catch(e=> console.log(e))
            await this.ortak.sleep(10)
        }
    }

    async CheckPrice5Saniye(){
        // console.log(suankiPrice, besSaniyeOncekiPrice, besSaniyeFark, onSaniyeFark);
        const binance5saniyeFark = this.Get5SaniyeFark(markets.BINANCE)
        const bitmex5saniyeFark = this.Get5SaniyeFark(markets.BITMEX)

        if(isNaN(binance5saniyeFark) || isNaN(bitmex5saniyeFark)) return
        const binanceFarkUyuyor = Math.abs(binance5saniyeFark) > this.binanceFark
        if(binanceFarkUyuyor){ // ilk önce binance farkı kontrol edilir.
            const binanceFiyatType = binance5saniyeFark < 0 ? FiyatType.DUSTU : FiyatType.CIKTI
            const bitmexFiyatType = bitmex5saniyeFark < 0 ? FiyatType.DUSTU : FiyatType.CIKTI
            if(binanceFiyatType == bitmexFiyatType){
                if(binance5saniyeFark > bitmex5saniyeFark){ // binance farkı bitmx farkından büyükse
                    const binanceBitmexFark = Math.abs(binance5saniyeFark) - Math.abs(bitmex5saniyeFark)
                    if(binanceBitmexFark < this.binanceFark) return   // binance ile bitmex farkları 2 den düşükse boşver.
                }else{
                    return // bitmex farkı binance farkından büykse çıkç zarar edersin.
                }
            }
            
            console.log('Time Difference Kontrolü')
            const timeDiff = new Date().getTime() - this.lastOrderDate.getTime()
            const enAz2SaniyeUygun = (timeDiff / 1000) > this.sonIslemBeklemeSuresi
            if(!enAz2SaniyeUygun || !this.position) return
            
            ///await this.ortak.BitmexCalcelAllOrders() // binance işleminden önce orderleri iptal et.
            
            const type = binance5saniyeFark < 0 ? OrderType.SELL : OrderType.BUY // eğer fark eksi ise sell yap, artı ise buy.
            // Fazla Alım Kontrolü
            const quantity = Math.abs(this.position.size)
            const kacCarpiGeride = Math.round((quantity / this.amount) +1)
            const fazlaAlimVar = kacCarpiGeride >= 6
            if(this.position.orderedType == type && fazlaAlimVar){ // position typeı ile yeni order type aynı ve fazla alım varsa girme.
                console.log("Binance: amountun 5 katı alış yaptı daha aynı işlemden alım yapma")
                return 
            }
            

            console.log(`!!!!!! İŞLEM YAPILIYOR. Fark 2 den büyük! Binance fark: ${binance5saniyeFark}, Bitmex fark: ${bitmex5saniyeFark} !!!!!!`)
            this.lastOrderDate = new Date()

            if(Math.abs(binance5saniyeFark) > 3){
                this.CreateOrder(type, this.amount * Math.abs(binance5saniyeFark), null, 'market')
            }else{
                //this.CreateOrder(type, this.amount * Math.abs(binance5saniyeFark), null, 'market')
                this.CreateOrder(type, this.amount * Math.abs(binance5saniyeFark), this.position[type+"s"][0].Price) // type ye sells için s takısı ekledim.
            }
        }
    }

    Get5SaniyeFark(market){
        if(market == markets.BINANCE){
            this.binancePriceList.unshift(this.binancePrice)
            this.binancePriceList =  this.binancePriceList.slice(0, 10)
            const suankiPrice = this.binancePriceList[0]
            const besSaniyeOncekiPrice = this.binancePriceList[4]
            const besSaniyeFark = suankiPrice - besSaniyeOncekiPrice
            this.loglama && console.log(`Binance Suanki Price : ${suankiPrice}, 5saniyeÖnceki: ${besSaniyeOncekiPrice}, fark: ${besSaniyeFark}`)
            return besSaniyeFark
        }else{ // binance değilse bitmex dir.
            this.bitmexPriceList.unshift(this.bitmexPrice)
            this.bitmexPriceList =  this.bitmexPriceList.slice(0, 10)
            const suankiPrice = this.bitmexPriceList[0]
            const besSaniyeOncekiPrice = this.bitmexPriceList[4]
            const besSaniyeFark = suankiPrice - besSaniyeOncekiPrice
            this.loglama && console.log(`BİTMEX   Suanki Price : ${suankiPrice}, 5saniyeÖnceki: ${besSaniyeOncekiPrice}, fark: ${besSaniyeFark}`)
            return besSaniyeFark
        }
    }

    async BinanceBasla(){

        binance.ws.aggTrades(['BTCUSDT'], trade => {
            this.binancePrice = trade.price
        })

        bitmex.addStream('XBTUSD', 'instrument', (data, symbol, tableName) => {
            this.bitmexPrice = data[data.length - 1].lastPrice
        })

        setInterval(() => {
            if(!this.binanceLastPrice ){ // || this.binanceLastPrice == this.binancePrice
                this.binanceLastPrice = this.binancePrice
                return
            }

            if(!this.bitmexLastPrice ){ // || this.bitmexLastPrice == this.bitmexPrice
                this.bitmexLastPrice = this.bitmexPrice
                return
            }

            this.CheckPrice5Saniye()
        }, 1000)
    }

    async PositionKontrol(){
        while(true){
            //this.position = await this.GetPositions()
            //const openOrders = await this.GetOpenOrders()
            const quantity = Math.abs(this.position.size)
            const type = this.position.orderedType == 'sell' ? OrderType.BUY : OrderType.SELL
            const openOrderZatenVar = this.openOrders.Data.find(e=> e.Amount == quantity && e.Type == type)
            const openPositionVar = this.position && this.position.entryPrice
            if(openOrderZatenVar || !openPositionVar){
                await this.ortak.sleep(10) // 10 saniye bir çalışır
                continue
            }

            await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
            await this.CreateOrder(type, quantity, this.position.orderPrice)// quantity + this.amount -> sattıktan sonra al
            await this.ortak.sleep(10) // 10 saniye bir çalışır
        }
    }

    CheckPrice5ve10Saniye(){
        this.binancePriceList.unshift(this.binancePrice)
        this.binancePriceList =  this.binancePriceList.slice(0, 10)
        const suankiPrice = this.binancePriceList[0]
        const besSaniyeOncekiPrice = this.binancePriceList[4]
        const onSaniyeOncekiPrice = this.binancePriceList[9]
        const besSaniyeFark = suankiPrice - besSaniyeOncekiPrice
        const onSaniyeFark = suankiPrice - onSaniyeOncekiPrice
        console.log(suankiPrice, besSaniyeOncekiPrice, besSaniyeFark, onSaniyeFark);
        const besSaniyeFarkUyuyor = besSaniyeFark && Math.abs(besSaniyeFark) > 2
        const onSaniyeFarkUyuyor = onSaniyeFark && Math.abs(onSaniyeFark) > 3
        if(besSaniyeFarkUyuyor){
            const type = besSaniyeFark < 0 ? 'sell' : 'buy' // eğer fark eksi ise sell yap, artı ise buy.
            this.CreateOrder(type, 100, null, 'market')
        }else if(onSaniyeFarkUyuyor){
            const type = onSaniyeFark < 0 ? 'sell' : 'buy' // eğer fark eksi ise sell yap, artı ise buy.
            this.CreateOrder(type, 100, null, 'market')
        }
    }

    async Basla10Dakika(){
        this.yeniAmount = this.amount
        //const position = await this.GetPositions()
        const kontrollerUygun = await this.KontrollerUygun()
        if(!kontrollerUygun) return
        //await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
        /*
        const openPositionVar = position && position.entryPrice
        if(openPositionVar){
            const quantity = Math.abs(position.size)
            await this.CreateOrder(position.nextOrderType, quantity, position.orderPrice)// quantity + this.amount -> sattıktan sonra al
        }
        */
        // BURAYA BALANCE KONTROL EKLENECEK
        await this.CreateOrder('buy', this.yeniAmount, this.position.buys[0].Price) 
        await this.CreateOrder('sell', this.yeniAmount, this.position.sells[0].Price)
    }

    async KontrollerUygun(){
        // BALANCE KONTROL
        
        const balances = await this.ortak.GetBalance()
        const openOrdersBalance = this.amount / this.position.sells[0].Price / this.kaldirac
        const balance = balances.find(e=> e.Symbol == 'XBT')
        const balanceValid = balance.Available > openOrdersBalance
        if(!balanceValid){
            console.log('Balance yeterli değil, güncelleniyor.', new Date())
            this.yeniAmount = balance.Available * this.position.sells[0].Price * this.kaldirac
            this.yeniAmount = this.amount - (this.amount * 0.05)
            this.yeniAmount = parseInt(this.amount)
            if(this.amount < 100){
                console.log('Balance 100 den küçük o yüzden çıkılıyor.');
                return false
            }
            console.log('Yeni Balance: '+ this.yeniAmount);
        }
    
        // OPEN ORDERSLAR ÜSTTE
        //const openOrders = await this.GetOpenOrders()
        let buyYadaSellUstte = false
        for (const openOrder of this.openOrders.Data) {
            if(openOrder.Rate == this.position.buys[0].Price){ // BUY
                buyYadaSellUstte = true
            }

            if(openOrder.Rate == this.position.sells[0].Price){ // SELL
                buyYadaSellUstte = true
            }
        }
       
        //const sellUstte = openOrders.sell && openOrders.sell.Rate == position.sells[0].Price
        if(buyYadaSellUstte){
            console.log('OpenOrder(s) üstte, yani sırada, işlem olacak. o yüzden çıkılıyor.', new Date())
            return false
        }

        // Fazla Alım Kontrolü
        const quantity = Math.abs(this.position.size)
        const kacCarpiGeride = Math.round((quantity / this.amount) +1)
        const fazlaAlimVar = kacCarpiGeride >= 6
        if(fazlaAlimVar){ // position typeı ile yeni order type aynı ve fazla alım varsa girme.
            console.log("10dk: amountun 5 katı alış yaptı daha aynı işlemden alım yapma")
            return 
        }
        

        return true // final
    }
    

    async GetPositions(position){
        //const ticker =  await this.ortak.ccx.exchange.fetchTicker(this.marketName) // awaitthis.ortak.ccx.GetMarket(marketName)
        //const orderBooks = await this.ortak.ccx.GetMarketOrders(this.marketName, 2)
        const sells = this.orderBooks.asks.map(e=> ({Price: e[0]}))
        const buys = this.orderBooks.bids.map(e=> ({Price: e[0]}))

        // Get Positions
        //const position = JSON.parse(await this.ortak.BitmexPositions())
        const positions =  position && position[0].avgEntryPrice && position.map(e=>{
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

        this.position = positions || {buys, sells}
        return positions || {buys, sells}

    }

    async CreateOrder(type, quantity, price, marketType = "limit"){
        const orderParams = ['BTC/USD', marketType, type, quantity, price]
        return await this.ortak.ccx.exchange.createOrder(...orderParams).catch(e => {
            console.log(e, 'BTC/USD')
        })
    }

    async GetOpenOrders(data){
        this.openOrders.Data = data.map(e=>({
            OrderId: e.orderID,
            Market: e.symbol,
            Type: e.side.toLowerCase(),
            Rate: e.price,
            Amount: e.orderQty,
            entryDate: e.timestamp
        }))

        this.openOrders.buy = this.openOrders.Data.find(e=> e.Type == 'buy') 
        this.openOrders.sell = this.openOrders.Data.find(e=> e.Type == 'sell') 
    }

}



module.exports = SellKontrol

let sellKontrol

async function Basla(){
    sellKontrol = new SellKontrol()
    await sellKontrol.LoadVeriables()
    sellKontrol.Basla()
}

Basla()
