const Ortak = require('./ortak')

class EldeKalanCoinler {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
    }
    
    async BaslaSell(){ // baseCoin hangi coinle alacağı
        this.balances = await this.ortak.GetBalance()
        const totalBalances = this.balances.filter(e=> e.Total > 0) // direk sell yapacağız.
        await this.ortak.fbBalancesUpdate(totalBalances)
        let openOrders = await this.ortak.GetFbData(`cry/sell-open-orders`) 
        openOrders = openOrders && Object.keys(openOrders).map(e=> ({
                market: openOrders[e].market, 
                orderId: openOrders[e].orderId,
                price: openOrders[e].price,
                amount: openOrders[e].amount,
                total: openOrders[e].total
            })) // object to array

        // TEST
        /*
        var balance = this.balances.find(x=> x.Symbol=="XAS")
        this.HangiMarketteEnPahali(balance.Symbol)
        return
        */
        // await this.BalanceEsitle() // Şimdilik kapalı. Hangi coin en az gidiyorsa ona çevrilecek.

        for (const balance of totalBalances) {
            if(balance.Symbol == "REP"){
                var dur = 1
            }
            if(this.ortak.mainMarkets.includes(balance.Symbol)) continue  // Ana market kontrolü

            if(balance.Total == balance.Available){
                 await this.SellKur(balance)
            }else{
                this.balance = balance
                const openOrder = openOrders && openOrders.find(e=> e.market.split('/')[0] == balance.Symbol)
    
                if(!openOrder) continue
                // buy kontrol
                //await this.BuyaKoyKontrol() 
                await this.SelleKoyKontrol(balance, openOrder)
            }

            // History Kaydet
            //await this.SaveHistory(balance.Symbol)
        }
    }

    async SelleKoyKontrol(balance, openOrder){
        // Daha iyi market var mı? varsa boz. ve o markette kur. 
        const dahaIyiMarketVar = await this.ortak.DahaIyiMarketVarmi(openOrder, 'sell')

        if(dahaIyiMarketVar){
            console.log('Daha iyi Market var!', openOrder.market);
            await this.SellBoz(balance, openOrder) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
            return
        }

        this.bizimTutarin3te1i = openOrder.total // 3te birini tamamı yaptık. / 3 * 1
        const marketOrders = await this.ortak.GetOrderBook(openOrder.market) // bunu önce geçen kontrolü için alıyoruz. burda alıyoruz çünkü awaiti var.
        if(!marketOrders) return //de datası yoksa dön. 
        //const marketOrderPrice = marketOrder.Sell[0].Price
        const result = await this.OneGecenVarmiKontrolSell(marketOrders, openOrder)

        // true ise pazarı boz.
        if(result){
            await this.SellBoz(balance, openOrder) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
        }
    }

    async SellKur(balance){
        if(balance.Symbol == 'TPAY'){
            this.dur = 1
        }
        const uygunBuyMarket = await this.ortak.HangiMarketteEnPahaliBuy(balance.Symbol)
        let market
        if(uygunBuyMarket){
            market = uygunBuyMarket
        }else{
            market = await this.ortak.HangiMarketteEnPahali(balance.Symbol)
        }

        if(!market) return
        const baseMarket = market.market.split('/')[1]
        const ondalikliSayi = this.ortak.SetPrices(market.market)
        const limit = this.ortak.limits[baseMarket] / 2
        const total = balance.Available * market[market.type][0][0]
        //const totalBuy = balance.Available * market.sell
        if(total < limit) return
        const price = market[market.type][0][0]
        //const buyPrice = market.buy

        let newPrice
        if(market.type == 'asks'){
            newPrice = price - ondalikliSayi // -1 fiyatını belirliyoruz sell de en öne koymak için
        }else{
            newPrice = price
        }
        
        await this.ortak.Submit(market.market, newPrice, balance.Available, 'sell'  ).then(async(e)=>{
            if(!e.id) return
            await this.ortak.InsertOrderFb(e, 'sell')
        }).catch(e=> console.log(e))
    }

    async SellBoz(balance, openOrder){
        await this.ortak.ccx.CancelTrade(openOrder.orderId, openOrder.market).then(async (e)=>{
            await this.ortak.DeleteOrderFb(openOrder, 'sell')
            console.log(`${openOrder.market} Cancel edildi'`)
            balance.Available = openOrder.amount
            await this.SellKur(balance)
        }).catch(async (e) => { 
            console.log(e)
            /*
            var errorCode = e.message.replace('cry {"error_code":','').replace('}','')
            if(errorCode == 1009){
                await this.ortak.DeleteOrderFb(openOrder, 'sell')
            }else{
                console.log(e, (errorCodes[errorCode]), openOrder.market)
            }     
            */   
        })
    }

    OneGecenVarmiKontrolSell(marketOrders, openOrder) {
        const kacinciInfo = this.ortak.GetKacinci(marketOrders, openOrder, 'asks') // asks for sell.

        // Bir satoshi kontrol
        const SellIlkVeIkinci1Satoshi = (kacinciInfo.ikinciSellPrice - openOrder.price).toFixed(10) > 0.00000001 && openOrder.amount == kacinciInfo.ilkSellTutar // -> ikinci kontrol: 
        if (marketOrders.asks[0][0] == openOrder.price && SellIlkVeIkinci1Satoshi) { // Eğer biz sell de en öndeysek ve bi arkamızdaki ile aramızda 1 satoshi fark yoksa boz  
            console.log(openOrder.market + ' bozuluyor. 1 satoshi kontrolü');
            return true
        }

        const ondekiTutarKontrolu = this.ortak.OndekiTutarKontrolu(kacinciInfo.sellSirasi, marketOrders, 'asks')

        if(ondekiTutarKontrolu){
            console.log(openOrder.market + ' bozuluyor. Öndeki Tutar Kontrolü');
            return true
        }else{
            return false
        }
    }
    
/*
    async BalanceEsitle(){
        //const btcBalance = this.balances.find(e.Symbol == 'BTC').Available
        const ltcBalance = this.balances.find(e=> e.Symbol == 'LTC').Available
        const dogeBalance = this.balances.find(e=> e.Symbol == 'DOGE').Available
        this.SetPrices('LTC/BTC') //ondalikliSayi için BTC LTC DOGE aynı
        if(ltcBalance > 1 ){
            const satilacakBalance = ltcBalance - 1
            await this.GetOrderBook('LTC/BTC')
            const sellPrice = marketOrders.asks[0][0] - this.ondalikliSayi
            const total = sellPrice * satilacakBalance
            if(total < this.limits["BTC"]) return
            this.Submit('LTC/BTC', sellPrice, satilacakBalance, 'Sell')
        }

        if(dogeBalance > 100000 ){
            const satilacakBalance = dogeBalance - 100000
            await this.GetOrderBook('DOGE/LTC')
            const sellPrice = marketOrders.asks[0][0] - this.ondalikliSayi
            const total = sellPrice * satilacakBalance
            if(total < this.limits["LTC"]) return
            this.Submit('DOGE/LTC', sellPrice, satilacakBalance, 'Sell')
        }
    }
    */
}

module.exports = EldeKalanCoinler

async function BaslaSell() {
    var eldeKalanCoinler = new EldeKalanCoinler()
    await eldeKalanCoinler.LoadVeriables()
    while(true){
        await eldeKalanCoinler.BaslaSell().catch(e=> console.log(e))
    }
}

BaslaSell()
