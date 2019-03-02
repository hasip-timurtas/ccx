const rp = require('request-promise').defaults({maxRedirects:20})
const crypto = require('crypto')
var account_key = '608ee3c9c194a48f5e8494f68b89c063'
var games = ['E', 'O', 'R', 'B', 'L18', 'H18']
var options = { 
    headers: {
        'Cookie': "account_key=" + account_key 
    },
    json: true, // Automatically parses the JSON string in the response
    jar: true
}

var functionAdet = 1
var betCredit = 1

if(process.argv[2]){
    account_key = process.argv[2]
    console.log("Yeni account key girildi key: "+ account_key);
}

if(process.argv[3]){
    betCredit = process.argv[3]
    console.log("Yeni betCredit girildi betCredit: "+ betCredit);
}


if(process.argv[4]){
    functionAdet = process.argv[4]
    console.log("Yeni functionAdet girildi adet: "+ functionAdet);
}


async function BetBaslat(){
    var baslangicBet = betCredit * 10000
    var bet = betCredit * 10000
    var seedReesult = await rp({jar:true, json:true, url: 'https://cashgames.bitcoin.com/roulette/reseed?account_key='+account_key}).catch(e=> console.log(e))
    var seedHash = seedReesult.server_seed_hash
    var balance
    while(true){
        if(balance && balance < baslangicBet){
            console.log("Balance Bitti")
            await sleep(10)
            continue
        }

        var randomNumber = Math.floor(Math.random() * 6)
        var game = games[randomNumber]
        var client_seed = crypto.randomBytes(32).toString('hex')
        options.url = `https://cashgames.bitcoin.com/roulette/spin?server_seed_hash=${seedHash}&client_seed=${client_seed}&progressive_bet=0&${game}=${bet}&use_fake_credits=true`
        var result = await rp(options).catch(e=> console.log(e))
        if(result.error== 'insufficient_funds') return console.log('Balance Bitti Çıkıyor.')
        if(result.error == 'invalid bet'){
            console.log(result.error)
            bet = baslangicBet
            continue
        }
        balance = result.fake_intbalance
        console.log("###################    BALANCE :  "+ result.fake_intbalance / 10000);
        
        seedHash = result.server_seed_hash
        if(result.intwinnings > 0){
            bet = baslangicBet
            console.log("YENDİ bet: ", bet / 10000)
        }else{
            /*
            if(bet / baslangicBet >= 32){
                console.log("Çok Kaybetti. bet başa dön bet: ", bet / 10000)
                bet = baslangicBet
            }else{
                bet = bet * 2
                console.log("Kaybetti. yeni bet: ", bet / 10000)
            }
            */
            bet = bet * 2
            if(bet > balance){
                console.log('Balance bitti, bet sıfırlanıyor. bet: ', bet / 10000)
                bet = baslangicBet
                continue
            }

            console.log("Kaybetti. bet: ", bet / 10000)
            
        }
       
    }
   
}

async function AradaBirRandom(){
    var baslangicBet = betCredit * 10000
    var bet = betCredit * 10000
    var seedReesult = await rp({jar:true, json:true, url: 'https://cashgames.bitcoin.com/roulette/reseed?account_key='+account_key}).catch(e=> console.log(e))
    var seedHash = seedReesult.server_seed_hash
    var balance
    while(true){
        if(balance && balance < baslangicBet){
            console.log("Balance Bitti")
            await sleep(10)
            continue
        }
        var randomNumber = Math.floor(Math.random() * 6)
        var game = games[randomNumber]
        var client_seed = crypto.randomBytes(32).toString('hex')
        options.url = `https://cashgames.bitcoin.com/roulette/spin?server_seed_hash=${seedHash}&client_seed=${client_seed}&progressive_bet=0&${game}=${bet}&use_fake_credits=true`
        var result = await rp(options).catch(e=> console.log(e))
        if(result.error== 'insufficient_funds') return console.log('Balance Bitti Çıkıyor.')
        seedHash = result.server_seed_hash
        if(result.intwinnings > 0){
            console.log("Aradabir kazandı 1")
        }else{
            console.log("Aradabir kaybetti 1")
        }
    
        await sleep(randomNumber)
    }
}

function sleep (saniye) {
    return new Promise(resolve => setTimeout(resolve, saniye * 1000))
}

AradaBirRandom()
for (let index = 0; index < functionAdet; index++) {
    BetBaslat().catch(e=> e)
}