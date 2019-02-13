const Ortak = require('./ortak')
const waitTime = 1 // dakika
const Binance = require('binance-api-node').default
const BitMEXClient = require('../dll/bitmex-realtime-api')


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
        this.amount = 10
        this.marginAmount = 0.5
        this.marketName = 'BTC/USD'
        this.kaldirac = 50
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
        this.positionData = []
        this.position = null
        this.orderBooks = null
        this.openOrders = {Data: []}
        this.walletnData = {}
        this.onDakikaSayac = 0
        this.positionKontrolSayac = 0

    }

    async Basla(){
        this.BalanceYazdir()
        console.log('Bütün orderlar iptal ediliyor.')
        await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
        console.log('Web socket dataları hazırlanıyor...')
        this.StartWsData()
        await this.ortak.sleep(10)
        console.log('Web socket dataları hazır.')

        this.PositionKontrol()
        this.OnDakika()
        this.BinanceBasla()
        
    }

    async PositionKontrol(){
        setInterval(() => this.positionKontrolSayac++, 1000)
        while(true){
            //this.position = await this.GetPositions()
            //const openOrders = await this.GetOpenOrders()
            if(!this.position){
                await this.ortak.sleep(1)
                continue
            }
            const quantity = Math.abs(this.position.size)
            const type = this.position.orderedType == 'sell' ? OrderType.BUY : OrderType.SELL
            const openPositionVar = this.position && this.position.entryPrice
            const positionOpenOrderda = this.openOrders.Data.find(e=> e.Amount == quantity && e.Type == type)
            const positionKardaVeUstte = positionOpenOrderda && this.position.positionKarda &&  this.position.positionKacinciSirada == 0
            if(!openPositionVar || positionKardaVeUstte){
                this.positionKontrolSayac = 0
                await this.ortak.sleep(10) // 10 saniye bir çalışır
                continue
            }

            await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
            //if(this.lastPositionOrderId) await this.ortak.ccx.CancelTrade(this.lastPositionOrderId, this.marketName)
            const result = await this.CreateOrder(type, quantity, this.position.orderPrice)// quantity + this.amount -> sattıktan sonra al
            //this.lastPositionOrderId = result.id
            this.positionKontrolSayac = 0
            await this.ortak.sleep(10) // 10 saniye bir çalışır
        }
    }

    async OnDakika(){
        setInterval(() => this.onDakikaSayac++, 1000)
        while(true){
            await this.Basla10Dakika().catch(e=> console.log(e))
            this.onDakikaSayac = 0
            await this.ortak.sleep(60)
        }
    }
    
    async Basla10Dakika(){
        this.yeniAmount = this.amount
        //const position = await this.GetPositions()
        const kontrollerUygun = await this.KontrollerUygun()
        if(!kontrollerUygun) return
        //await this.ortak.BitmexCalcelAllOrders() // Open Ordersları iptal et.
        // BURAYA BALANCE KONTROL EKLENECEK
        await this.CreateOrder('buy', this.yeniAmount, this.orderBooks.buys[0].Price)
        await this.ortak.sleep(1)
        await this.CreateOrder('sell', this.yeniAmount, this.orderBooks.sells[0].Price)
    }

    async KontrollerUygun(){
        // OPEN ORDERSLAR ÜSTTE
        //const openOrders = await this.GetOpenOrders()
        let buyYadaSellUstte = false
        for (const openOrder of this.openOrders.Data) {
            if(openOrder.Rate == this.orderBooks.buys[0].Price){ // BUY
                buyYadaSellUstte = true
            }

            if(openOrder.Rate == this.orderBooks.sells[0].Price){ // SELL
                buyYadaSellUstte = true
            }
        }
       
        //const sellUstte = openOrders.sell && openOrders.sell.Rate == position.sells[0].Price
        if(buyYadaSellUstte){
            console.log('OpenOrder(s) üstte, yani sırada, işlem olacak. o yüzden çıkılıyor.', new Date())
            return false
        }

        // Fazla Alım Kontrolü
        if(this.position){ // posizyon varsa
            const quantity = Math.abs(this.position.size)
            const kacCarpiGeride = parseInt((quantity / this.amount) +1)
            const fazlaAlimVar = kacCarpiGeride >= 6
            if(fazlaAlimVar){ // position typeı ile yeni order type aynı ve fazla alım varsa girme.
                console.log("10dk: position 5 katı, geç.")
                return false
            }
        }
        
        // BALANCE KONTROL
        const balances = await this.ortak.GetBalance()
        const openOrdersBalance = this.amount / this.orderBooks.sells[0].Price / this.kaldirac
        const balance = balances.find(e=> e.Symbol == 'XBT')
        const balanceValid = balance.Available > openOrdersBalance
        if(!balanceValid){
            console.log('Balance yeterli değil, güncelleniyor.', new Date())
            this.yeniAmount = balance.Available * this.orderBooks.sells[0].Price * this.kaldirac
            this.yeniAmount = this.amount - (this.amount * 0.05)
            this.yeniAmount = parseInt(this.amount)
            if(this.amount < 100){
                console.log('Balance 100 den küçük o yüzden çıkılıyor.');
                return false
            }
            console.log('Yeni Balance: '+ this.yeniAmount);
        }
        return true // final
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
            
            console.log(type + ' YAPACAK');
            console.log(`!!!!!! İŞLEM YAPILIYOR. Fark 2 den büyük! Binance fark: ${binance5saniyeFark}, Bitmex fark: ${bitmex5saniyeFark} !!!!!!`)
            // binance sinyali geldiğinde buy ise selli open ordersları iptal et. sell ise buyları iptal et. 
            const willCacancelType = type == 'sell' ? 'buy' : 'sell'
            this.openOrders.Data.filter(e=> {
                if(e.Type == willCacancelType){
                    this.ortak.ccx.CancelTrade(e.OrderId,this.marketName).catch(e=> console.log(e))
                }
            })
            
            // Fazla Alım Kontrolü
            if(this.position){ // posizyon varsa
                const quantity = Math.abs(this.position.size)
                const kacCarpiGeride = parseInt((quantity / this.amount) +1)
                const fazlaAlimVar = kacCarpiGeride >= 6
                if(fazlaAlimVar && this.position.orderedType == type){ // position typeı ile yeni order type aynı ve fazla alım varsa girme.
                    console.log("BİNANCE: amountun 5 katı alış yaptı daha aynı işlemden alım yapma")
                    return false
                }
            }
            
            this.lastOrderDate = new Date()
            const newAmount = parseInt(this.amount * Math.abs(binance5saniyeFark))
            if(Math.abs(binance5saniyeFark) > 4){
                this.CreateOrder(type, newAmount, null, 'market')
            }else{
                //this.CreateOrder(type, this.amount * Math.abs(binance5saniyeFark), null, 'market')
                const result = await this.CreateOrder(type, newAmount, this.orderBooks[type+"s"][0].Price) // type ye sells için s takısı ekledim.
                setTimeout(() => { // 10 saniye sonra oluşturulan limit orderi iptal et eklendi
                    result.id && this.ortak.ccx.CancelTrade(result.id,this.marketName).catch(e=> console.log(e))
                }, 1000 * 30);
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

        setInterval(() => {
            if(!this.binanceLastPrice ){ // || this.binanceLastPrice == this.binancePrice
                this.binanceLastPrice = this.binancePrice
                return
            }

            if(!this.bitmexLastPrice ){ // || this.bitmexLastPrice == this.bitmexPrice
                this.bitmexLastPrice = this.bitmexPrice
                return
            }

            this.CheckPrice5Saniye().catch(e=> console.log(e))
        }, 1000)
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

    GetPositions(position){
        const positions =  position && position.map(e=>{
            const orderedType = e.currentQty < 0 ? 'sell' : 'buy' // size negatif ise sell yapılmış pozitif ise buy.
            const nextOrderType =  orderedType == 'sell' ? 'buy' : 'sell' // next order of the position
            let orderPrice, positionKarda = false
            
            if(orderedType == 'sell'){
                orderPrice = e.avgEntryPrice - this.marginAmount // ne kadara satacağım bilgisi eğer 3550 den aldıysam 3545 den satıcam. marginAmount 5$ ise
                const sayiSonu5Yada0 = ['0','5'].includes(orderPrice.toString().split(".")[1])
                orderPrice = sayiSonu5Yada0 ? orderPrice : parseInt(orderPrice)
                if(orderPrice > this.orderBooks.buys[0].Price) { // position kârda
                    orderPrice = this.orderBooks.buys[0].Price
                    positionKarda = true
                }
               
            }else{
                orderPrice = e.avgEntryPrice + this.marginAmount // ne kadara satacağım bilgisi eğer 3550 den aldıysam 3555 den satıcam. marginAmount 5$ ise
                const sayiSonu5Yada0 = ['0','5'].includes(orderPrice.toString().split(".")[1])
                orderPrice = sayiSonu5Yada0 ? orderPrice : parseInt(orderPrice)
                if(orderPrice < this.orderBooks.sells[0].Price) { // position kârda
                    orderPrice = this.orderBooks.sells[0].Price
                    positionKarda = true
                }
                
            }

            const positionKacinciSirada = this.orderBooks[nextOrderType+"s"].findIndex(e=> e.Price == orderPrice)

            return {
                size: e.currentQty, 
                entryPrice: e.avgEntryPrice, 
                markPrice: e.markPrice, 
                liqPrice: e.liquidationPrice,
                orderedType,
                nextOrderType,
                orderPrice,
                sellNowPrice: e.currentQty > 0 ? this.orderBooks.sells[0].Price : this.orderBooks.buys[0].Price, // bir dahaki işlem yani yukarıdaki orderedType in tersini yaptık. almışsa yukarıda buy yazar, almış ve satacağı için burada sell yazar.
                positionKacinciSirada,
                positionKarda
            }
        })[0]

        this.position = positions
        return positions

    }

    async CreateOrder(type, quantity, price, marketType = "limit"){
        const orderParams = ['BTC/USD', marketType, type, quantity, price]
        return await this.ortak.ccx.exchange.createOrder(...orderParams).catch(e => {
            console.log(e, 'BTC/USD')
        })
    }

    async GetOpenOrders(data){
        for (const e of data) {
            if( e.ordStatus == 'New'){
                this.openOrders.Data.push({
                    OrderId: e.orderID,
                    Market: e.symbol,
                    Type: e.side.toLowerCase(),
                    Rate: e.price,
                    Amount: e.orderQty,
                    entryDate: e.timestamp
                })
            }else{
                this.openOrders.Data = this.openOrders.Data.filter(a => a.OrderId != e.orderID)
            }
        }

        this.openOrders.buy = this.openOrders.Data.find(e=> e.Type == 'buy') 
        this.openOrders.sell = this.openOrders.Data.find(e=> e.Type == 'sell')
    }

    async StartWsData(){

        binance.ws.aggTrades(['BTCUSDT'], trade => {
            this.binancePrice = trade.price
        })

        bitmex.addStream('XBTUSD', 'instrument', (data, symbol, tableName) => {
            if(!data[data.length - 1].lastPrice) return
            this.bitmexPrice = data[data.length - 1].lastPrice
        })

    
        bitmex.addStream('XBTUSD', 'order', (data, symbol, tableName) => {
            const gercekOrderlar = data.filter(e=> e.ordStatus)
            if(data.length == 0 || gercekOrderlar.length == 0) return
            this.GetOpenOrders(data)
        })

        await this.ortak.sleep(4)

        bitmex.addStream('XBTUSD', 'orderBook10', (data, symbol, tableName) => {
            const datam = data[data.length - 1]
            this.orderBooks = { sells: datam.asks.map(e=> ({Price: e[0]})) , buys: datam.bids.map(e=> ({Price: e[0]}))}
        })

        await this.ortak.sleep(4)

        bitmex.addStream('XBTUSD', 'position', (data, symbol, tableName) => {
            //const gercekPositions = data.filter(e=> e.avgEntryPrice)
            //if(gercekPositions.length == 0) return
            for (const key in data[0]) {
                if (data[0].hasOwnProperty(key)) {
                    this.positionData[key] = data[0][key];
                }
            }

            this.GetPositions([this.positionData])
        })
        
        bitmex.addStream('XBTUSD', 'margin', (data, symbol, tableName) => {
            for (const key in data[0]) {
                if (data[0].hasOwnProperty(key)) {
                    this.walletnData[key] = data[0][key];
                }
            }
        })
    }

    async BalanceYazdir(){
        while(true){
            const walletBalance = this.walletnData.walletBalance / 100000000
            const marginBalance = this.walletnData.marginBalance / 100000000
            console.log(`Wallet Balance: ${walletBalance}  | Margin Balance: ${marginBalance} | ondk Sayac: ${this.onDakikaSayac} | positionKontrolSayac: ${this.positionKontrolSayac}`);
            await this.ortak.sleep(5)
        }
        
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
