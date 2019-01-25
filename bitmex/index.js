const Ortak = require('./ortak')
const rp = require('request-promise')

class SellKontrol {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables('MONGO')
        this.kaldirac = 50
        this.amount = 350
        this.marginAmount = 5
        this.minYuzde = 2
    }

    async BitmexBasla(){
        const marketName = 'BTC/USD'
        //const balances = await this.ortak.GetBalance()
        const ticker =  await this.ortak.ccx.exchange.fetchTicker(marketName) // awaitthis.ortak.ccx.GetMarket(marketName)

        // Get Positions
        const result = JSON.parse(await this.ortak.BitmexPositions())
        const positions = result && result.map(e=>{
            const orderedType = e.currentQty < 0 ? 'sell' : 'buy' // size negatif ise sell yapılmış pozitif ise buy.
            let profitYuzde
            if(orderedType == 'sell'){
                profitYuzde = (e.avgEntryPrice - ticker.last ) / ticker.last * 100 // sell yapmışsam last price Entry priceden %1 küçük olmalı en az.
                profitYuzde = profitYuzde * this.kaldirac  // gerçek kârı görmek için kaldıraç ile çarp. yoksa normal btc fiyat farkını verir.
            }else{
                profitYuzde = (ticker.last  - e.avgEntryPrice) / e.avgEntryPrice * 100 // sell yapmışsam last price Entry priceden %1 küçük olmalı en az.
                profitYuzde = profitYuzde * this.kaldirac // gerçek kârı görmek için kaldıraç ile çarp. yoksa normal btc fiyat farkını verir.
            }

            return {
                size: e.currentQty, 
                entryPrice: e.avgEntryPrice, 
                markPrice: e.markPrice, 
                lastPrice: e.lastPrice, 
                liqPrice: e.liquidationPrice,
                profitYuzde,
                orderedType
            }
        })[0]
        
        // Positionlarda kâr varsa sat.
        if(positions.entryPrice && positions.profitYuzde >= this.minYuzde){ // Açık posizyon varsa ve en az %1 karda ise
            // position var ve en az %1 karda
            const type = positions.orderedType == 'sell' ? 'buy' : 'sell' // sell yapmışsa buy yapıcaz. değilse tam tersi.
            const quantity = Math.abs(positions.size) // amount için size nigatif ise pozitif yap

            await this.CreateOrder(type, quantity, null, 'market') // open positionu direk satıyoruz.  -- AMA market ile satıyoruz. 3 kat daha fazla fee var.
        }
        

        // Open Ordersları iptal et.
        await this.ortak.BitmexCalcelAllOrders()

        // şimdi yeni ordersları aç. Buy ve sell için -+ 5 dolardan açıcaz
        const buyResult = await this.CreateOrder('buy', this.amount, ticker.last - this.marginAmount)
        const sellResult = await this.CreateOrder('sell', this.amount, ticker.last + this.marginAmount)
        
        
    }



    async CreateOrder(type, quantity, price, marketType = "limit"){
        const orderParams = ['BTC/USD', marketType, type, quantity, price]
        return await this.ortak.ccx.exchange.createOrder(...orderParams).catch(e => {
            console.log(e, 'BTC/USD')
        })
    }

    async CancelOrder(openOrder){
        return await this.ortak.ccx.CancelTrade(openOrder.orderId, openOrder.market).catch(async (e) => {
            console.log(e, openOrder.market)
        })
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
}



module.exports = SellKontrol

let sayac = 0
let sellKontrol

async function Basla(){
    sayac++
    sellKontrol = new SellKontrol()
    await sellKontrol.LoadVeriables()
    while(true){
        await sellKontrol.BitmexBasla().catch(e=> console.log(e))
        await sellKontrol.ortak.sleep(60 * 15)
    }
}

Basla()