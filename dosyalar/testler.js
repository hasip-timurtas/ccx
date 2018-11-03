const Ortak = require('./ortak')

class Testler {
    async LoadVeriables(){
        this.ortak = new Ortak()  // Ortak Yükle
        await this.ortak.LoadVeriables()
        this.islemdekiler = []
        this.sonCoin = '1'
        setInterval(()=> console.log('Son işlenen: ' + this.sonCoin), 5000 )
        
    }

    SetAllData(){
        if(this.ortak.allData.length > 0) return
        let allData = this.ortak.GetOrderBooks(null, true) // null market listesi burada boş veriyoruz, all true çünkü bütün datayı alıyoruz.
        if(!allData) return false
        
        allData = allData.filter(e=>{
            const sonuc = e.asks && e.asks[0] && e.asks[0].rate != 0.00000001 && e.bids && e.bids[0]
            return sonuc
        })
        this.ortak.allData = allData
    }

    Basla(){
        this.SetAllData()
        const karliMarketler = []
        const allCoins = this.ortak.allActiveCoins
        //const balancemdekiCoinler = ['FROST', 'DRC', 'LGS', 'UNO', 'CEFS', 'PRJ', 'GRFT', 'PASL', 'GRWI', 'UNIT', 'ABC'] // test
        for (const coin of allCoins) { // allCoins
            const enKarliMarket = this.ortak.MarketTotalleriGetir(coin)

            if(enKarliMarket && enKarliMarket.fark >= 1){
                var log = "Btcden karlı market var."
                console.log(log, enKarliMarket)
                karliMarketler.push(enKarliMarket)
            }
        }
        console.log('Bitti')
        console.log(karliMarketler.length)
    }

    BaslaBirCoin(coin){
        if(this.islemdekiler.includes(coin)) return
        this.islemdekiler.push(coin)
        console.log(this.islemdekiler)
        this.SetAllData()
        const enKarliMarket = this.ortak.MarketTotalleriGetir(coin)
        if(enKarliMarket && enKarliMarket.fark >= 1){
            var log = "Btcden karlı market var."
            console.log(log, enKarliMarket)
            this.ortak.InsertTestler(enKarliMarket)
            //karliMarketler.push(enKarliMarket)
        }
        this.islemdekiler = this.islemdekiler.filter(a => a != coin)
        this.sonCoin = coin
    }
}

async function Basla() {
    const testler = new Testler()
    await testler.LoadVeriables()
    testler.ortak.wsDepth.WsBaslat(coin=> testler.BaslaBirCoin(coin))
    /*
    while(testler.ortak.wsDataProcessing){
        await testler.ortak.sleep(1)
    }

    console.time('test')
    testler.Basla()
    console.timeEnd('test')
    */
}

Basla()
