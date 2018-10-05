
const MhtCcxt = require('../dll/mhtCcxt')
const ccx = new MhtCcxt(null, null, 'cryptopia', null)
const mongodb = require('mongodb');
const rp = require('request-promise')

class OkexWsDepth {

    constructor(){
        this.uygunMarkets = []
        this.pingMsg = `{'event':'ping'}`
        //this.url = "mongodb://localhost:27017/"; // production
        this.url = "mongodb://209.250.238.100:27017/"; // test
        this.mainMarkets = ['BTC', 'LTC', 'DOGE']
        this.marketsData = []
    }

    async Basla(){
        this.connection = await mongodb.MongoClient.connect(this.url, { useNewUrlParser: true });
        this.depths = this.connection.db('cry').collection('depths')
        await this.GetHerMarketteOlanlar()
        console.log(this.uygunMarkets.length + ' aded coin var')
        await this.InsertCoinsToDb()
        for(var i=0; i < this.uygunMarkets.length; i = i + 5){
            this.GetOrderBookGroup(this.uygunMarkets.slice(i, i + 5 ))// 5er 5er kayıt göndereecek
            //console.log(this.uygunMarkets.slice(i, i+ 5 )); // 5er 5er kayıt göndereecek
        }
    }

    async GetHerMarketteOlanlar(){
        var markets = await ccx.exchange.load_markets()
        var coins = Object.keys(markets).map(e=> markets[e]).filter(e=> e.quote == 'BTC').map(e=>e.baseId.toUpperCase())
        coins = coins.filter(e=> !this.mainMarkets.includes(e))
        var duzgunMarketler = Object.keys(markets).map(e=> markets[e]).map(e=> e.baseId + '/' + e.quoteId).map(e=> e.toUpperCase())
        var allTickers = await ccx.GetMarkets()

        // main marketleri ekliyorum. USDT, BTC, ETH için aşağıdaki üç ana market var. cryde ise ltc/btc, doge/ltc ve doge/btc vardı.
        this.uygunMarkets.push({ market: 'LTC/BTC', depths: 0 })
        this.uygunMarkets.push({ market: 'DOGE/LTC', depths: 0 })
        this.uygunMarkets.push({ market: 'DOGE/BTC', depths: 0 })
        
        for (const coin of coins) {

             // coin her makette var mı ?
             var marketUsdt = coin + '/BTC'
             var marketBtc = coin + '/LTC'
             var marketEth = coin + '/DOGE'
             
             var herMarketteVar = duzgunMarketler.includes(marketUsdt) && duzgunMarketler.includes(marketBtc) && duzgunMarketler.includes(marketEth)
             var marketList = [coin + '/BTC', coin + '/LTC', coin + '/DOGE']
             var volumeUygun = allTickers.Data.filter(e=> e.Volume > 0.1 &&  marketList.includes(e.Label))

             if(herMarketteVar && volumeUygun.length > 1 ){
                this.uygunMarkets.push({ market: marketUsdt, depths: 0 })
                this.uygunMarkets.push({ market: marketBtc, depths: 0 })
                this.uygunMarkets.push({ market: marketEth, depths: 0 })
             }
        }
    }

    async InsertCoinsToDb(){
        //ckear collection
        await this.depths.deleteMany({})
        await this.depths.insertMany(this.uygunMarkets)
    }
    
    async GetOrderBookGroup(d){
        while(true){
            const marketNames = []
            for (const i of d) {
                marketNames.push(i.market.replace('/','_'))
            }
            const urlString = marketNames.join('-')
            
            const fullUrl = `https://www.cryptopia.co.nz/api/GetMarketOrderGroups/${urlString}/10`
            const result = await this.SendRequestOrderBook(fullUrl)
            if(!result || result.length < 5) continue

            // Eğer 5 markette bir güncelleme varsa güncellemeyi yaptırç
            var marketData = this.marketsData[urlString]
            if(JSON.stringify(result) != JSON.stringify(marketData)){
                await this.DepthUpdateFb(d, result)
                this.marketsData[urlString] = result
            }

            await this.sleep(500)
        }
    }

    async DepthUpdateFb(besMarket, result){ // d: markets
        var uygunFormat = besMarket.filter(e=> {    
                var market = result.find(x => x.Market == e.market.replace('/', '_'))
                e.depths =  { 
                    bids : market.Buy.map(e=> ([e.Price, e.Total / e.Price ])), 
                    asks: market.Sell.map(e=> ([e.Price, e.Total / e.Price ])) 
                }
                return true
            })

        for (const i of uygunFormat) {
            this.depths.updateOne({market: i.market}, {$set: { depths: i.depths }})
        }
    }

    async SendRequestOrderBook(url){
        const orderBooks = await rp(url).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(!orderBooks){
            return await this.SendRequestOrderBook(url)
        }else{
            return orderBooks.Data
        }
    }

    sleep (salisel) {
		return new Promise(resolve => setTimeout(resolve, salisel))
	}
}

let okexWsDepth
let sayac = 1

OkexDepthBasla()
setInterval(()=> OkexDepthBasla(), 1000 * 60 * 60 * 2) // 1 saate bir yeniden başlasın

function OkexDepthBasla(){
    console.log(sayac + '. kez başlatıldı..')
    okexWsDepth = new OkexWsDepth()
    okexWsDepth.Basla().catch(e=>{
        console.log(e)
        console.log('tekrardan başlatılıyor.')
        OkexDepthBasla()
    })
}