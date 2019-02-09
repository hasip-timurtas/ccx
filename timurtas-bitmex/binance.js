const Ortak = require('./ortak')
const waitTime = 15 // dakika
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
        this.marginAmount = 1
        this.marketName = 'BTC/USD'
        this.checkPositionAktif = false
        this.ikinciIslemFark = 7
        this.orderType = {
            BUY: 1,
            DIRAKBUY: 2,
            SELL: 3,
            DIREKSELL: 4,
            BUYSELL: 5
        }
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

    }

    CheckPrice5Saniye(){
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
            const enAz2SaniyeUygun = (timeDiff / 1000) > 2
            if(!enAz2SaniyeUygun) return

            const type = binance5saniyeFark < 0 ? OrderType.SELL : OrderType.BUY // eğer fark eksi ise sell yap, artı ise buy.
            console.log(`!!!!!! İŞLEM YAPILIYOR. Fark 2 den büyük! Binance fark: ${binance5saniyeFark}, Bitmex fark: ${bitmex5saniyeFark} !!!!!!`)
            this.CreateOrder(type, this.amount, null, 'market')
            this.lastOrderDate = new Date()
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
            const position = await this.GetPositions()
            const openOrders = await this.GetOpenOrders()
            const quantity = Math.abs(position.size)
            const type = position.orderedType == 'sell' ? OrderType.BUY : OrderType.SELL
            const openOrderZatenVar = openOrders.Data.find(e=> e.Amount == quantity && e.Type == type)
            if(openOrderZatenVar){
                await this.ortak.sleep(60) // 10 dkda bir çalışır
                continue
            }
            await this.ortak.BitmexCalcelAllOrders() 

            await this.CreateOrder(type, quantity, position.orderPrice)// quantity + this.amount -> sattıktan sonra al
            await this.ortak.sleep(60) // 10 dkda bir çalışır
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

        /*
        const openBuyVeSellVar = openOrders.buy && openOrders.sell
        const amountlarUygun = openOrders.buy.Amount == this.amount && openOrders.sell.Amount == this.amount // open buy ve sell varsa (amount uygunsa)
        const openOrdersVar = openBuyVeSellVar && amountlarUygun
        if(!openOrdersVar){
            console.log('open orderslar zaten var. o yüzden çıkılıyor.', new Date())
            return false
        }
        */
        return true // final
    }
    

    async BitmexBasla(){
        //if(this.checkPositionAktif) return
        //const balances = await this.ortak.GetBalance()
        const openOrders = await this.GetOpenOrders()
        const position = await this.GetPositions()
        const openBuyVeSellVar = openOrders.buy && openOrders.sell
        const openPositionVar = position && position.entryPrice
        if(openBuyVeSellVar){
            if(openPositionVar){
                let openOrderIkiTaneAmaPoisionAcikDegil = false
                for (const openOrder of openOrders.Data) {
                    if(openOrder.Amount == Math.abs(position.size)){
                        openOrderIkiTaneAmaPoisionAcikDegil = true
                    }
                }
                if(openOrderIkiTaneAmaPoisionAcikDegil){
                    return
                }
            }
        }
        
        
        //if(openOrders.Data.length == 1 && openOrders.Data[0].Amount == Math.abs(position.size) && openOrders.Data[0].Rate == position.orderPrice) return

        await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
        
        // Positionlarda kâr varsa sat.
        if(openPositionVar) {
            position.orderedType == 'sell' && this.SellYaptiBuyYap(position)
            position.orderedType == 'buy' && this.BuyYaptiSellYap(position)
        }else{
           this.OrderYokBuySellYap(position) // price bilgisi bunun içinde
        }
    }

    async SellYaptiBuyYap(position){
        const quantity = Math.abs(position.size)
        const kacCarpiGeride = Math.round((quantity / this.amount) +1)
        const fazlaAlimVar = kacCarpiGeride == 3

        await this.CreateOrder('buy', quantity, position.orderPrice)// quantity + this.amount -> sattıktan sonra al
        !fazlaAlimVar && await this.CreateOrder('sell', this.amount * 2, position.sells[0].Price + this.ikinciIslemFark)
        !fazlaAlimVar && await this.CreateOrder('sell', this.amount, position.sells[0].Price + this.ikinciIslemFark + this.ikinciIslemFark) // 3. işlem
    }

    async BuyYaptiSellYap(position){
        const quantity = Math.abs(position.size)
        const kacCarpiGeride = Math.round((quantity / this.amount) +1)
        const fazlaAlimVar = kacCarpiGeride == 3

        await this.CreateOrder('sell', quantity, position.orderPrice)// quantity + this.amount -> sattıktan sonra al 
        !fazlaAlimVar && await this.CreateOrder('buy', this.amount * 2, position.buys[0].Price - this.ikinciIslemFark) // buy ise buy 2 katı arkada dursun + this.amount
        !fazlaAlimVar && await this.CreateOrder('buy', this.amount, position.buys[0].Price - this.ikinciIslemFark - this.ikinciIslemFark ) // 3. işlem
    }

    async OrderYokBuySellYap(position){
        //await this.CreateOrder('buy', this.amount, position.buys[0].Price) // fiyat normal buy-sell yap
        //await this.CreateOrder('sell', this.amount, position.sells[0].Price)
        // Fiyata göre işlem şimdilik deaktif
        //return
        const result = await this.GetOHLCV(position.buys[0].Price)
        switch (result) {
            case this.orderType.BUY: // test için tam tersini yapıyoruz. çok sell varsa sell yap.
                return await this.CreateOrder('buy', this.amount, position.buys[0].Price)
            case this.orderType.SELL: // test için tam tersini yapıyoruz. çok buy varsa buy yap.
                return await this.CreateOrder('sell', this.amount, position.sells[0].Price)
            case this.orderType.BUYSELL:
                await this.CreateOrder('buy', this.amount, position.buys[0].Price) // fiyat normal buy-sell yap
                await this.CreateOrder('sell', this.amount, position.sells[0].Price)
                break
            default:
                console.log("OrderYokBuySellYap hatalı switch değeri. Değer: "+ result)
                break;
        }
    }

    async GetOHLCV(price){
        const oneHourAgo = new Date(new Date().getTime() - 60 * 60 * 1000) // 1,5 saat öncesi
        let grafiks = await this.ortak.ccx.exchange.fetchOHLCV(this.marketName, '5m', oneHourAgo)
        grafiks = grafiks.map(e=> ({date: new Date(e[0]), open: e[1], high: e[2], low: e[3], close: e[4], volume: e[5]}))

        const low = grafiks.map(e=> e.low).sort((a,b)=> a-b)[0]
        const high = grafiks.map(e=> e.high).sort((a,b)=> b-a)[0]
        const fark = high - low
        const farkYuzde20 = fark / 5 // %20 fark hesaplama için 5'e böldük
        const farkYuzde10 = fark / 10
        const lowVe10 = low + farkYuzde10
        const lowVe20 = low + farkYuzde20
        const highVe10 = high - farkYuzde10
        const highVe20 = high - farkYuzde20
        // örnek: low = 1000, high = 2000; price = 1000
        if(price < lowVe20){ // mesela fiyat 1200 den küçükse sell yap çünkü daha düşerbilir ama
            if(price < lowVe10){ // fiyat 1100 den küçükse buy yap. çok düştü dipte tekrar çıkacak demek
                console.log('Fiyat çok düşük, dipte, buy yapılıyor. Çünkü fiyatı çıkacak. high, low, price: ', high, low, price)
                return this.orderType.BUY // Price çok düküş buy yap.
            }
            console.log('Fiyat düşük ama dipte değil, az çıktı tekrar düşebilir. o yüzden sell yapılıyor. high, low, price: ', high, low, price)
            return this.orderType.SELL // Price düştü ama dipte değil, az çıktı tekrar düşebilir, o yüzden sell yap.
        }else if(price > highVe20){
            if(price > highVe10){
                console.log('Fiyat çok çıktı, tepede, sell yapılıyor. Çünkü fiyatı düşecek. high, low, price: ', high, low, price)
                return this.orderType.SELL // Price Çok çıktı sell yap
            }
            console.log('Fiyat çıktı ama tepede değil, az düştü tekrar çıkabilir. o yüzden buy yapılıyor. high, low, price: ', high, low, price)
            return this.orderType.BUY // Price çıktı ama tepede değil, az düştü tekrar çıkabilir.
        }else{
            // price normal buy ve sell yap
            console.log('Fiyat ortalamada buy ve sell yap ', high, low, price)
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
 
    async CheckPositions(){
        const history = JSON.parse(await this.ortak.BitmexHistory())
        const position = await this.GetPositions()
        this.checkPositionAktif = false // normal şartlardan bunu deaktif yap.
        if(position && position.entryPrice) {  //  Açık posizyon varsa
            const lastFilled = history.find(e=> e.execType == 'Trade')
            const sonFillKacSaatOnce = Math.abs(new Date() - new Date(lastFilled.transactTime)) / 36e5;
            const ilkDorducnuSirada = Math.abs(position.entryPrice - position.sellNowPrice) < 3
            if(sonFillKacSaatOnce >= 2 && ilkDorducnuSirada){ // posizyon 1 saattir açıksa kapat
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
    sellKontrol.BinanceBasla()
    sellKontrol.PositionKontrol()
}

Basla()
