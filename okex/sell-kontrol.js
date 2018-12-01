const Ortak = require('./ortak')

class SellKontrol {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables('MONGO')
        this.orderYenile = true
        setInterval(()=> this.orderYenile = true, 1000 * 60 * 60 * 1) // 2 saatte bir ordersleri sil.
        this.ortak.db.ref('okex/buy-sell-buy-coin').on('value', snap => this.BuySellListener(snap.val()))
    }

    async BuySellListener(coin){
        console.log('BuySellListener for: ' + coin)
        const balances = await this.ortak.GetBalance()
        const balance = balances.find(e=> e.Symbol == coin && e.Available > 0)
        if(!balance) return
        this.SellKurKontrol(balance)
    }
    
    async BaslaSell(){ // baseCoin hangi coinle alacağı
        console.log('>>>>>>>>>>>  BaslaSell BAŞLADI  >>>>>>>>>>>')
        const wsProcessing = await this.ortak.GetVariable('ws-processing') // ws process ediliyormu çek.
        if(wsProcessing && wsProcessing.value){
            console.log('ws process işlemi oluyor, beklemede.')
            await this.ortak.sleep(2)
            return
        }
        const balances = await this.ortak.GetBalance()
        let totalBalances = balances.filter(e=> e.Total > 0)
        await this.ortak.fbBalancesUpdate(totalBalances)
        const openOrders = await this.ortak.GetOpenOrders()

        //await this.OrdersTotalHesapla(balances, openOrders)
        /*const mainBalances = balances.filter(e=> this.ortak.mainMarkets.includes(e.Symbol))
        await this.BalanceEsitle(mainBalances) // Şimdilik kapalı. Hangi coin en az gidiyorsa ona çevrilecek.*/

        if(false){
            //  ################     TEST     ################    TEST    ################     TEST     ################
            const testCoins = ['MANA'] // Dizi Olmalı
            totalBalances = totalBalances.filter(e=> testCoins.includes(e.Symbol))
            this.orderYenile = false // cancel all ordere girmemesi için.
        }
        //this.orderYenile = false // TEST
        if(this.orderYenile){
            return await this.CancelAllOrders(openOrders) // ordersları cancel ettikten sonra balance değişecek o yüzden tekrar girsin.
        }

        const islemdeBalances = totalBalances.filter(e=> e.Total != e.Available)
        const availableBalances = totalBalances.filter(e=> e.Total == e.Available)

        const promise1 = this.BalanceIslemdeOlanlar(islemdeBalances, openOrders)
        const promise2 = this.BalanceAvilableOlanlar(availableBalances)
        await Promise.all([promise1, promise2]).catch(e=> console.log(e))
        await this.ortak.sleep(2) // 2 saniye bekle
    }

    async BalanceAvilableOlanlar(balances){
        for (const balance of balances) {
            if(!this.BalanceKontroller(balance)) continue
            await this.SellKurKontrol(balance)
        }
    }

    async BalanceIslemdeOlanlar(balances, openOrders){
        for (const balance of balances) {
            if(!this.BalanceKontroller(balance)) continue
            const openOrder = openOrders && openOrders.find(e=> e.market.split('/')[0] == balance.Symbol)
            if(!openOrder) continue // TODO: balanceler eşit değilse ve open ordersta yoksa dbde yok demek. ordersi bi şekilde iptal et.
            await this.SelleKoyKontrol(balance, openOrder)
        }
    }

    BalanceKontroller(balance){
        var coinMarkets = this.ortak.marketsInfos.filter(e=> e.base == balance.Symbol && e.active == true)
        if(coinMarkets.length < 3) return false
        if(this.ortak.mainMarkets.includes(balance.Symbol)) return false  // Ana market kontrolü
        return true
    }

    async BalanceKontrol(balance){
        const marketName = balance.Symbol + '/USDT' 
        const orderBook = await this.ortak.GetOrderBook(marketName)
        if(!orderBook) {
            console.log(balance.Symbol+' ws-db de kaydı yok')
            return false
        }
        const btcTotal = orderBook.asks[0].rate * balance.Total
        return btcTotal >= this.ortak.limits['USDT']
    }

    async SelleKoyKontrol(balance, openOrder){
        // Daha iyi market var mı? varsa boz. ve o markette kur. 
        const dahaIyiMarketVar = await this.ortak.DahaIyiMarketVarmi(openOrder, 'sell')

        if(dahaIyiMarketVar){
            console.log('Daha iyi Market var!', openOrder.market)
            await this.SellBoz(balance, openOrder) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
            return
        }

        this.bizimTutarin3te1i = openOrder.total // 3te birini tamamı yaptık. / 3 * 1
        const marketOrders = await this.ortak.GetOrderBook(openOrder.market) // bunu önce geçen kontrolü için alıyoruz. burda alıyoruz çünkü awaiti var.
        if(!marketOrders) return
        //const marketOrderPrice = marketOrder.Sell[0].Price
        const result = await this.OneGecenVarmiKontrolSell(marketOrders, openOrder)

        // true ise pazarı boz.
        if(result){
            await this.SellBoz(balance, openOrder) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
        }
    }

    async SellKurKontrol(balance){
        if(balance.Symbol == 'BON'){
            this.dur = 1
        }
        let market

        const uygunBuyMarket = await this.ortak.HangiMarketteEnPahaliBuy(balance.Symbol)
        if(uygunBuyMarket){
            market = uygunBuyMarket
        }else{
            market = await this.ortak.HangiMarketteEnPahali(balance.Symbol)
        }

        if(!market) return
        market.balance = balance
        await this.SellKur(market)
        
    }

    async SellKur(market){
        const baseMarket = market.market.split('/')[1]
        const ondalikliSayi = this.ortak.SetPrices(market.market)
        const limit = this.ortak.sellLimits[baseMarket]
        const total = market.balance.Available * market[market.type][0]['rate']
        //const totalBuy = balance.Available * market.sell
        if(total < limit) return
        const price = market[market.type][0]['rate']
        //const buyPrice = market.buy

        let newPrice
        if(market.type == 'asks'){
            newPrice = price - ondalikliSayi // -1 fiyatını belirliyoruz sell de en öne koymak için
        }else{
            newPrice = price
        }
        
        await this.ortak.SubmitSellKontrol(market.market, newPrice, market.balance.Available, 'sell'  ).then(async(e)=>{
            if(!e.id) return
            await this.ortak.InsertOrderFb(e, 'sell')
        }).catch(e=> {console.log(e)})
    }

    async SellBoz(balance, openOrder){
        await this.ortak.ccx.CancelTrade(openOrder.orderId, openOrder.market).then(async (e)=>{
            await this.ortak.DeleteOrderFb(openOrder.market, 'sell')
            console.log(`${openOrder.market} Cancel edildi'`)
            balance.Available = openOrder.amount
            //await this.SellKurKontrol(balance)
        }).catch(async (e) => {
            if(e.message.includes('No matching trades found')){
                await this.ortak.DeleteOrderFb(openOrder.market, 'sell')
            }else{
                console.log(e, openOrder.market)
            }  
        })
    }

    OneGecenVarmiKontrolSell(marketOrders, openOrder) {
        const kacinciInfo = this.ortak.GetKacinci(marketOrders, openOrder, 'asks') // asks for sell.

        // Bir satoshi kontrol
        const SellIlkVeIkinci1Satoshi = (kacinciInfo.ikinciSellPrice - openOrder.price).toFixed(10) > 0.00000001 && openOrder.amount == kacinciInfo.ilkSellTutar // -> ikinci kontrol: 
        if (marketOrders.asks[0]['rate'] == openOrder.price && SellIlkVeIkinci1Satoshi) { // Eğer biz sell de en öndeysek ve bi arkamızdaki ile aramızda 1 satoshi fark yoksa boz  
            console.log(openOrder.market + ' bozuluyor. 1 satoshi kontrolü');
            return true
        }

        const ondekiTutarKontrolu = this.ortak.OndekiTutarKontrolu(kacinciInfo.sellSirasi, marketOrders, 'asks')

        if(ondekiTutarKontrolu){
            console.log(openOrder.market + ' bozuluyor. Öndeki Tutar Kontrolü.');
            return true
        }else{
            return false
        }
    }
    
    async BalanceEsitle(balances){
        //const btcBalance = balances.find(e.Symbol == 'BTC').Available
        const ltcBalance = balances.find(e=> e.Symbol == 'LTC').Available
        const dogeBalance = balances.find(e=> e.Symbol == 'DOGE').Available
        const ondalikliSayi = this.ortak.SetPrices('LTC/BTC') //ondalikliSayi için BTC LTC DOGE aynı
        if(ltcBalance > 4 ){
            const satilacakBalance = ltcBalance - 4
            if(satilacakBalance >= this.ortak.limits['LTC']){
                const marketOrders = await this.ortak.GetOrderBook('LTC/BTC')
                const sellPrice = marketOrders.asks[0]['rate'] - ondalikliSayi
                this.ortak.SubmitSellKontrol('LTC/BTC', sellPrice, satilacakBalance, 'Sell')
            }
            
        }

        if(dogeBalance > 50000 ){
            const satilacakBalance = dogeBalance - 50000
            if(satilacakBalance >= this.ortak.limits['DOGE']){
                const marketOrders = await this.ortak.GetOrderBook('DOGE/LTC')
                const sellPrice = marketOrders.asks[0]['rate'] - ondalikliSayi
                this.ortak.SubmitSellKontrol('DOGE/LTC', sellPrice, satilacakBalance, 'Sell')
            }
        }
    }

    async OrdersTotalHesapla(balances, openOrders){
        const btcBalance = balances.find(e=> e.Symbol == 'BTC')
        const usdtBalance = balances.find(e=> e.Symbol == 'USDT')
        const ethBalance = balances.find(e=> e.Symbol == 'ETH')
        const ethBtcOrder = await this.ortak.GetOrderBook('ETH/BTC')
        const btcUsdtOrder = await this.ortak.GetOrderBook('BTC/USDT')

        let totalBtc = btcBalance.Total // btc yi direk attık
        totalBtc += ethBtcOrder.asks[0].rate * ethBalance.Total   // eth to btc balance
        totalBtc += usdtBalance.Total / btcUsdtOrder.asks[0].rate  // usdt to btc balance
        
        for (const order of openOrders) {
            const base = order.market.split('/')[1]
            const total = order.total
            if(base == 'ETH'){
                const ethBtcTotal = ethBtcOrder.asks[0].rate * total
                totalBtc += ethBtcTotal
            }else if(base == 'USDT'){
                const btcUsdtTotal = total / btcUsdtOrder.asks[0].rate
                totalBtc += btcUsdtTotal
            }else{
                totalBtc += total
            }
        }

        this.ortak.SetVariable('okex-order-total', totalBtc.toFixed(8)) // veritabanına open ordersların BTC toplamını ekliyoruz.
    }

    async CancelAllOrders(openOrders){
        console.log('BÜTÜN ORDERLAR İPTAL EDİLİYORRRRRRRRRRRRRRRRRR.')
        for (const order of openOrders) {
            await this.ortak.ccx.CancelTrade(order.orderId, order.market).then(e=>{
                this.ortak.DeleteOrderFb(order.market, 'sell')
            }).catch(e=> {
                if(!e.message.toLowerCase().includes('nonce')) this.ortak.DeleteOrderFb(order.market, 'sell') // nonce hatası değilse dbden sil.
            })
        }
        this.ortak.SetVariable('CancelAllOrders', new Date())
        this.orderYenile = false
    }
}

module.exports = SellKontrol

let sayac = 0
let sellKontrol

async function Basla(){
    sayac++
    sellKontrol = new SellKontrol()
    await sellKontrol.LoadVeriables()
    //await sellKontrol.ortak.sleep(60)
    while(true){
        await sellKontrol.BaslaSell().catch(e=> console.log(e))
    }
}

Basla()