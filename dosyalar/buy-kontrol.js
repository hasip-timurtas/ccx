const errorCodes = require('./erors')
const Ortak = require('./ortak')

class EldeKalanCoinler {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
    }

    async BaslaBuy(){ // baseCoin hangi coinle alacağı
        let openOrders = await this.ortak.GetFbData(`okex/okex-buy-open-orders`) 
        if(!openOrders) {
            console.log('openOrders boş. ÇIK.')
            return
        } // open orders boşsa dön.
        openOrders = openOrders && Object.keys(openOrders).map(e=> ({
                market: openOrders[e].market, 
                orderId: openOrders[e].orderId,
                price: openOrders[e].price,
                amount: openOrders[e].amount,
                total: openOrders[e].total
            })) // object to array

        for (const order of openOrders) {
            await this.BuyaKoyKontrol(order) 
        }
    }

    
    async BuyaKoyKontrol(openOrder){
        // Daha iyi market var mı? varsa boz. ve o markette kur. 
        const dahaIyiMarketVar = await this.ortak.DahaIyiMarketVarmi(openOrder, 'buy')

        if(dahaIyiMarketVar){
            console.log('Daha iyi Market var!');
            await this.BuyBoz(openOrder) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
            return
        }

        this.bizimTutarin3te1i = openOrder.total // 3te birini tamamı yaptık. / 3 * 1
        const marketOrders = await this.ortak.GetOrderBook(openOrder.market) // bunu önce geçen kontrolü için alıyoruz. burda alıyoruz çünkü awaiti var.
        if(!marketOrders) return // de datası yoksa dön. 
        //const marketOrderPrice = marketOrder.Sell[0].Price
        const result = await this.OneGecenVarmiKontrolBuy(marketOrders, openOrder)

        // true ise pazarı boz.
        if(result){
            await this.BuyBoz(openOrder) // sell bozduktan sonra gidip daha iyi markete bakıyor ve o markette kuruyor.
        }
    }

    async BuyBoz(openOrder){
        await this.ortak.ccx.CancelTrade(openOrder.orderId, openOrder.market).then(async (e)=>{
            await this.ortak.DeleteOrderFb(openOrder, 'buy')
            console.log(`${openOrder.market} Cancel edildi'`)
            const coin = openOrder.market.split('/')[0]
            await this.ortak.MinMaxKontrol(coin)
        }).catch(async (e) => {
            var errorCode = e.message.replace('okex {"error_code":','').replace('}','')
            console.log(e, (errorCodes[errorCode]), openOrder.market)
            if(errorCode == 1009){
                await this.ortak.DeleteOrderFb(openOrder, 'buy')
            }else{
                console.log(e, (errorCodes[errorCode]), openOrder.market)
            }
        })
    }

    OneGecenVarmiKontrolBuy(marketOrders, openOrder) {
        const kacinciInfo = this.ortak.GetKacinci(marketOrders, openOrder, 'bids') // bids for buys

        // Bir satoshi kontrol
        const SellIlkVeIkinci1Satoshi = (kacinciInfo.ikinciSellPrice - openOrder.price).toFixed(10) > 0.00000001 && openOrder.amount == kacinciInfo.ilkSellTutar // -> ikinci kontrol: 
        if (marketOrders.bids[0][0] == openOrder.price && SellIlkVeIkinci1Satoshi) { // Eğer biz sell de en öndeysek ve bi arkamızdaki ile aramızda 1 satoshi fark yoksa boz  
            console.log(openOrder.market + ' bozuluyor. 1 satoshi kontrolü');
            return true
        }

        const ondekiTutarKontrolu = this.ortak.OndekiTutarKontrolu(kacinciInfo.sellSirasi, marketOrders, 'bids')

        if(ondekiTutarKontrolu){
            console.log(openOrder.market + ' bozuluyor. Öndeki Tutar Kontrolü');
            return true
        }else{
            return false
        }
    }
}

module.exports = EldeKalanCoinler

async function BaslaBuy() {
    var eldeKalanCoinler = new EldeKalanCoinler()
    await eldeKalanCoinler.LoadVeriables()

    while(true){
        await eldeKalanCoinler.BaslaBuy().catch(e=> console.log(e))
        await eldeKalanCoinler.ortak.sleep(10)
    }
}

BaslaBuy()
