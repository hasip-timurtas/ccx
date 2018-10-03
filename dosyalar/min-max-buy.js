const WebSocket = require('ws')
const Ortak = require('./ortak')

class EldeKalanCoinler {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
    }

    MinMaxBaslat(coins){
        console.log(coins.length + ' adet coinle girdi.')
        for (const coin of coins) {
            if(this.ortak.islemdekiCoinler.includes(coin) || this.ortak.mainMarkets.includes(coin)) continue // coin işlemdeyse veya main marketse geç
            this.ortak.MinMaxKontrol(coin)
        }
    }

    WsBaslat(){
        var wsApi = new WebSocket("wss://crycomreal.bafang.com:10441/websocket");
        var message = "{event:'addChannel',parameters:{'binary':'0','type':'all_ticker_3s'}}"
        var pingMsg = `{'event':'ping'}`

        wsApi.onmessage = (msg) => {
            var data = JSON.parse(msg.data)
            if(data.event == 'pong' || data.data.result) return // pong değilse array gelecek.
            var coins = data.data.filter(e=> {
                if(e.id.includes('t-')){
                    var coin = e.id.replace('t-','').split('_')[0].toUpperCase()
                    var baseCoin = e.id.replace('t-','').split('_')[1].toUpperCase()
                    e.coin = coin
                    return baseCoin != 'OKB'                    
                }else{
                    return false
                }
            })
            coins = coins.map(e=> e.coin)
            let unique = [...new Set(coins)]; 
            this.MinMaxBaslat(unique)
        }

        wsApi.onerror = (err) =>{
            console.log(err);
        }

        wsApi.onclose= () => {
            setTimeout(() => { this.WsBaslat() }, 2000); // bağlantı koptuğunda 2 saniye sonra birdaha bağlan
        }
    
        wsApi.onopen = () =>{
            wsApi.send(message)
            setInterval(()=> wsApi.send(pingMsg), 20 * 1000) // 20 saniyede bir ping atar.
        }
    }
}

module.exports = EldeKalanCoinler

async function BaslaBuy() {
    var eldeKalanCoinler = new EldeKalanCoinler()
    await eldeKalanCoinler.LoadVeriables()
    eldeKalanCoinler.WsBaslat()
}

BaslaBuy()
