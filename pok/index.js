const rp = require('request-promise').defaults({maxRedirects:20})
const crypto = require('crypto')
var account_key = '145f4a0aac17e1e8bdfd2bc8a4fb7226'
var baslangicBet = 10000
var bet = 10000
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

    while(true){
        var randomNumber = Math.floor(Math.random() * 6)
        var game = games[randomNumber]
        var client_seed = crypto.randomBytes(32).toString('hex')
        options.url = `https://cashgames.bitcoin.com/roulette/spin?server_seed_hash=${seedHash}&client_seed=${client_seed}&progressive_bet=0&${game}=${bet}&use_fake_credits=true`
        var result = await rp(options).catch(e=> console.log(e))
        seedHash = result.server_seed_hash
        if(result.intwinnings > 0){
            bet = baslangicBet
            console.log("YENDİ bet: ", bet)
        }else{
            bet = bet * 2
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
    while(true){
        var randomNumber = Math.floor(Math.random() * 6)
        var game = games[randomNumber]
        var client_seed = crypto.randomBytes(32).toString('hex')
        options.url = `https://cashgames.bitcoin.com/roulette/spin?server_seed_hash=${seedHash}&client_seed=${client_seed}&progressive_bet=0&${game}=${bet}&use_fake_credits=true`
        var result = await rp(options).catch(e=> console.log(e))
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