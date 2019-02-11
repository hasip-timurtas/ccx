const Ortak = require('./ortak')
const waitTime = 1 // dakika
const Binance = require('binance-api-node').default
const BitMEXClient = require('bitmex-realtime-api');
const markets = {
    BINANCE: 0,
    BITMEX: 1
}

const OrderType = {
    SELL: 'sell',
    BUY: 'buy'
}

const FiyatType = {
    DUSTU: 'Fiyat DÜŞTÜ',
    CIKTI: 'Fiyat ÇIKTI'
}

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
        this.binanceFark = 3
        this.loglama = false
        this.lastOrderDate = new Date()
        this.sonIslemBeklemeSuresi = 5 // saniye
    }

    async Basla(){
        
        this.PositionKontrol()
        await this.ortak.sleep(1) // Nonce için 1 saniye bekle.
        this.OnDakika()
        await this.ortak.sleep(1) // Nonce için 1 saniye bekle.
        this.BinanceBasla()
        
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

            if(binance5saniyeFark > 5){
                this.CreateOrder(type, this.amount * Math.abs(binance5saniyeFark), null, 'market')
            }else{
                this.CreateOrder(type, this.amount * Math.abs(binance5saniyeFark), this.position[type][0].Price)
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
        const binance = Binance()
        
        // See 'options' reference below
        const bitmex = new BitMEXClient({testnet: false});

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
            this.position = await this.GetPositions()
            const openOrders = await this.GetOpenOrders()
            const quantity = Math.abs(this.position.size)
            const type = this.position.orderedType == 'sell' ? OrderType.BUY : OrderType.SELL
            const openOrderZatenVar = openOrders.Data.find(e=> e.Amount == quantity && e.Type == type)
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
        const position = await this.GetPositions()
        const kontrollerUygun = await this.KontrollerUygun(position)
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

        // Fazla Alım Kontrolü
        const quantity = Math.abs(position.size)
        const kacCarpiGeride = Math.round((quantity / this.amount) +1)
        const fazlaAlimVar = kacCarpiGeride >= 6
        if(fazlaAlimVar){ // position typeı ile yeni order type aynı ve fazla alım varsa girme.
            console.log("10dk: amountun 5 katı alış yaptı daha aynı işlemden alım yapma")
            return 
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
    sellKontrol = new SellKontrol()
    await sellKontrol.LoadVeriables()
    sellKontrol.Basla()
}

Basla()
