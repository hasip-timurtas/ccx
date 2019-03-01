const rp = require('request-promise').defaults({maxRedirects:20})
const crypto = require('crypto')
var account_key = '41544ae460af6f728a66855990f9305b'
var betCredit = 1
var baslangicBet = betCredit * 10000
var bet = betCredit * 10000
var games = ['E', 'O', 'R', 'B', 'L18', 'H18']
var options = { 
    headers: {
        'Cookie': "account_key=" + account_key 
    },
    json: true, // Automatically parses the JSON string in the response
    jar: true
}

async function BetBaslat(){
    AradaBirRandom()

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
        balance = result.fake_intbalance
        seedHash = result.server_seed_hash
        if(result.intwinnings > 0){
            bet = baslangicBet
            console.log("YENDİ bet: ", bet / 10000)
        }else{
            bet = bet * 2
            if(bet > balance){
                bet = baslangicBet
                console.log('Balance bitti, bet sıfırlanıyor. bet: ', bet / 10000);
            }
            console.log("Kaybetti. bet: ", bet / 10000)
            /*
            if(bet / baslangicBet > 3){
                bet = baslangicBet
                console.log("Çok Kaybetti. bet başa dön: ", bet)
            }else{
                bet = bet * 2
                console.log("Kaybetti. bet: ", bet)
            }
            */
        }
    }
   
}

async function AradaBirRandom(){
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
        balance = result.fake_intbalance
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


BetBaslat()