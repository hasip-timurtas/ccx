const Ortak = require('./ortak')

class SellKontrol {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
    }

    cryWsBasla(){
        this.ortak.wsDepth.WsBaslat()
    }
    
    async BaslaSell(){ // baseCoin hangi coinle alacağı
        console.log('>>>>>>>>>>>  BaslaSell BAŞLADI  >>>>>>>>>>>')
        if(this.ortak.wsDataProcessing){
            console.log('Ws data yükleniyor. beklemede.')
            await this.ortak.sleep(2)
            return
        }
        this.balances = await this.ortak.GetBalance()
        const totalBalances = this.balances.filter(e=> e.Total > 0) // direk sell yapacağız.
        await this.ortak.fbBalancesUpdate(totalBalances)
        let openOrders = await this.ortak.GetFbData(`cry/sell-open-orders`) 
        await this.BalanceEsitle(this.balances) // Şimdilik kapalı. Hangi coin en az gidiyorsa ona çevrilecek.
        
        for (const balance of totalBalances) {
            if(this.ortak.wsDataProcessing) return
            if(balance.Symbol == "CNET"){
                var dur = 1
            }
            
            var coinMarkets = this.ortak.marketsInfos.filter(e=> e.baseId == balance.Symbol && e.active == true)
            if(coinMarkets.length < 3) continue
            
            if(this.ortak.mainMarkets.includes(balance.Symbol)) continue  // Ana market kontrolü
            /*
            const balanceKontrol = await this.BalanceKontrol(balance)
            if(!balanceKontrol) continue
            */
            if(balance.Total == balance.Available){
                await this.SellKurKontrol(balance)
            }else{
                this.balance = balance
                const openOrder = openOrders && openOrders.find(e=> e.market.split('/')[0] == balance.Symbol)
    
                if(!openOrder){
                    // balanceler eşit değilse ve open ordersta yoksa dbde yok demek. ordersi iptal et.
                    //await this.ortak.DeleteOrderFb(openOrder.market, 'sell')
                    continue
                }
                // buy kontrol
                //await this.BuyaKoyKontrol() 
                await this.SelleKoyKontrol(balance, openOrder)
            }
        }
    }

    async BalanceKontrol(balance){
        const marketName = balance.Symbol + '/BTC' 
        const orderBook = await this.ortak.GetOrderBook(marketName)
        if(!orderBook) {
            console.log(balance.Symbol+' ws-db de kaydı yok')
            return false
        }
        const btcTotal = orderBook.asks[0].rate * balance.Total
        return btcTotal >= this.ortak.limits['BTC']
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
            await this.SellKurKontrol(balance)
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



    async GetOrderBooks(marketler){
        let orderBooks = await this.depths.find( { 'market': { '$in': marketler } } ).toArray()
        orderBooks = orderBooks.map(e=> {
            if(!e.depths){
                return e
            }
            e.depths.market = e.market
            return e.depths
        }) //  içinde market ismi olan depths gönderiyoruz. orjinalinde yok.
        return orderBooks
    }



    async GetOrderBook(marketName){
        
        let marketOrders = await this.depths.findOne({ market: marketName } )
        if(!marketOrders){
            return null
        }
        marketOrders = marketOrders.depths
        
        return marketOrders
    }
}

module.exports = SellKontrol

let sayac = 0
let sellKontrol

async function Basla(){
    sayac++
    sellKontrol = new SellKontrol()
    await sellKontrol.LoadVeriables()
    sellKontrol.cryWsBasla()
    sellKontrol.ortak.wsZamanlayici = 1 // dakika test için
    while(sellKontrol.ortak.wsDataProcessing){
        await sellKontrol.ortak.sleep(1)
    }
    console.log('Sayaç Çalışma süresi: ' + sayac)
    while(true){
        await sellKontrol.BaslaSell().catch(e=> console.log(e))
    }
}

Basla()