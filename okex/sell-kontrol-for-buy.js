class SellKontrolForBuy {
    async LoadVeriables(ortak){
        this.ortak = ortak
    }

    async SellBaslat(coin){
        const balances = await this.ortak.GetBalance()
        const balance = balances.find(e=> e.Symbol == coin && e.Available > 0)
        if(!balance) return
        this.SellKurKontrol(balance)
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
}

module.exports = SellKontrolForBuy
