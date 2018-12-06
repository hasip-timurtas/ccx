
const MhtCcxt = require('../dll/mhtCcxt')
const ccx = new MhtCcxt(null, null, 'okex', null)
const WebSocket = require('ws');
const mongodb = require('mongodb');
const pako = require('pako')

class OkexWsDepth {

    constructor(){
        this.uygunMarkets = []
        this.pingMsg = `{'event':'ping'}`
        this.sayac = 0
        this.limit = 200
        //this.url = "mongodb://localhost:27017/okex-depths"; // production
        this.url = "mongodb://139.180.197.6:1453/"; // test
        this.mainMarkets = ['USDT', 'BTC', 'ETH', 'OKB']
        this.coins = []
    }

    async Basla(){
        this.connection = await mongodb.MongoClient.connect(this.url, { useNewUrlParser: true });
        this.depths = this.connection.db('okex').collection('ws-depths')
        await this.GetHerMarketteOlanlar()
        await this.InsertCoinsToDb()
        console.log(this.uygunMarkets.length + ' aded coin var')
        this.WsBaslat()
    }

    async GetHerMarketteOlanlar(){
        var markets = await ccx.exchange.load_markets()
        var coins = Object.keys(markets).map(e=> markets[e]).filter(e=> e.quote == 'BTC').map(e=>e.baseId.toUpperCase())
        coins = coins.filter(e=> !this.mainMarkets.includes(e))
        var duzgunMarketler = Object.keys(markets).map(e=> markets[e]).map(e=> e.baseId + '/' + e.quoteId).map(e=> e.toUpperCase())


        // main marketleri ekliyorum. USDT, BTC, ETH için aşağıdaki üç ana market var. cryde ise ltc/btc, doge/ltc ve doge/btc vardı.
        this.uygunMarkets.push({ market: 'BTC/USDT' })
        this.uygunMarkets.push({ market: 'ETH/USDT' })
        this.uygunMarkets.push({ market: 'ETH/BTC'})
        
        for (const coin of coins) {
             // coin her makette var mı ?
             var marketUsdt = coin + '/USDT'
             var marketBtc = coin + '/BTC'
             var marketEth = coin + '/ETH'
             // biz burda sadece isimleri giriyoruz websocket aşağıda updatede depths ve ticker lerini ekleyecek update ile.
             if(duzgunMarketler.includes(marketUsdt) && duzgunMarketler.includes(marketBtc) && duzgunMarketler.includes(marketEth)){
                this.uygunMarkets.push({ market: marketUsdt })
                this.uygunMarkets.push({ market: marketBtc})
                this.uygunMarkets.push({ market: marketEth })
             }
        }
    }

    async InsertCoinsToDb(){
        //ckear collection
        await this.depths.deleteMany({})
        //await this.depths.insertMany(this.uygunMarkets)
    }

    WsBaslat(){
        var wsApi = new WebSocket("wss://real.okex.com:10441/websocket");
        var depthMessage = ""
        wsApi.onmessage = (message) => {
            var msg = pako.inflateRaw(message.data, {to: 'string'})
            msg = JSON.parse(msg)
            if(msg.event == 'pong') return
            var data = msg[0] // pong değilse array gelecek.
            if(!data || data.data.error_code) return
            if(data.channel.includes('depth')){
                var marketName = data.channel.split('_')[3] +'/'+ data.channel.split('_')[4]
                marketName = marketName.toUpperCase()
                data.data.asks = data.data.asks.slice().reverse().map(e => ({ rate:e[0], amount:e[1], type:'asks'}))
                data.data.bids = data.data.bids.map(e => ({ rate:e[0], amount:e[1], type:'bids'}))
                this.depths.updateOne({market: marketName}, {$set: { depths: data.data}}, {upsert: true})
            }
        }

        wsApi.onerror = (err) =>{
            console.log(err);
        }

        wsApi.onclose= () => {
            setTimeout(() => { this.WsBaslat() }, 2000); // bağlantı koptuğunda 2 saniye sonra birdaha bağlan
        }
    
        wsApi.onopen = () =>{
            setInterval(()=> wsApi.send(this.pingMsg), 20 * 1000) // 20 saniyede bir ping atar.
            for (const uygunMarket of this.uygunMarkets) {
                var wsMarket =  uygunMarket.market.replace('/','_').toLowerCase()
                depthMessage = `{event:'addChannel','channel':'ok_sub_spot_${wsMarket}_depth_20', 'binary':'0' }` // 
                wsApi.send(depthMessage)
                /*
                tickerMessage =`{event':'addChannel','channel':'ok_sub_spot_${wsMarket}_ticker', 'binary':'0' }`
                wsApi.send(tickerMessage)
                */
            }
        }
    }
}

const okexWsDepth = new OkexWsDepth()
okexWsDepth.Basla().catch(e=> console.log(e))
