const rp = require('request-promise')
const crypto = require('crypto')
const ccxt = require ('ccxt');

class MhtCcxt {
  constructor (key, secret, exchangeId, baseCoin) {
    this.key = key
    this.secret = secret
    this.API_URL = 'https://www.cryptopia.co.nz/api/'
    this.exchangeId = exchangeId
    this.exchange = new ccxt[exchangeId](); // Örnek new Cryptopia('yobit')
    this.exchange.apiKey = key
    this.exchange.secret = secret
    this.exchange.timeout = 300000
    this.baseCoin = baseCoin
    this.pauseLoops = false
    this.ordersToplam = 0
    //this.exchange.enableRateLimit = true

  }

  async GetOhlcv(market, sure){
    return await this.exchange.fetchOHLCV (market, sure)
  }

  async GetCurrencies () {
    return this._public('GetCurrencies')
  }

  async GetTradePairs () {
    return this._public('GetTradePairs')
  }

  async GetMarkets (baseMarket, hours) {
    let markets = await this.exchange.load_markets()
    let symbols = this.exchange.symbols

    if(this.baseCoin){
      symbols = this.exchange.symbols.filter(e=> e.split('/')[1]== this.baseCoin)
    }
  
    if(this.exchangeId == 'yobit'){
      const result = await this.GetYobitMarkets(symbols)
      return { Data: result }
    }

    let allMarkets = await this.exchange.fetchTickers (symbols)

    return {Data: Object.keys(allMarkets).map(key => this.CommonFormat('market', allMarkets[key]))}
  }
  
  async GetMarket (market) {
    const ticker = await this.exchange.fetchTicker(market)
    return {Data: this.CommonFormat('market', ticker)};
  }

  async GetMarketHistory (market, hours) {
    return this._public('GetMarketHistory', { market, hours })
  }

  async GetMarketOrders (market, orderCount) {
    var orderBook = await this.exchange.fetchOrderBook (market)
    orderBook = this.CommonFormat('orderBook', {market, orderBook})
    return {Data:orderBook}
  }

  async GetMarketOrderGroups (markets, orderCount) {
    let orderBooks=[], orderBook
    if(this.exchangeId=='livecoin'){
      for(let market of markets.split('-')){
        if(market=='USD/ETH')
          continue
        orderBook = await this.exchange.fetchOrderBook (market, 2)
        orderBook = this.CommonFormat('orderBook', {market, orderBook})
        orderBooks.push(orderBook)
      }
      return {Data:orderBooks}
    }
    
    orderBooks = await this.exchange.fetchOrderBooks (markets.split('-'))
    return {Data:Object.keys(orderBooks).map(key => this.CommonFormat('orderBook', {market: key, orderBook: orderBooks[key]}))}
  }

  sleep (saniye) {
    return new Promise(resolve => setTimeout(resolve, saniye * 1000))
  }

  async GetBalance () {
    if(this.exchangeId == 'binance'){
      this.balances =  await this.exchange.fetchBalance({'recvWindow': 10000000})
    }else{
      this.balances =  await this.exchange.fetchBalance()
    }
    
    return {Data: Object.keys(this.balances).map(key => this.CommonFormat('balance', {symbol: key, balance: this.balances[key]}))}
  }

  async GetDepositAddress (Currency) {
    return await this._private('GetDepositAddress', { Currency }).catch(e => console.log(e))
  }

  async GetOpenOrders (Market, TradePairId, Count) {
    const orders = await this.exchange.fetchOpenOrders (Market)
    return {Data:Object.keys(orders).map(key => this.CommonFormat('orders',orders[key]))}
  }

  async GetAllOpenOrders () {
    let markets = await this.exchange.load_markets()
    let symbols = this.exchange.symbols.filter(e=> e.split('/')[1]== this.baseCoin)
    let openOrders = []
    for (const market of symbols) {
      const orders = await this.exchange.fetchOpenOrders (market)
      openOrders.push(openOrders)
    }
    

    return {Data:Object.keys(openOrders).map(key => this.CommonFormat('orders',openOrders[key]))}
  }


  async GetTradeHistory (Market, TradePairId, Count) {
    var tradeHistory
    if(this.exchangeId=='okex' || this.exchangeId=='livecoin' || this.exchangeId=='hitbtc'){
      tradeHistory = await this.exchange.fetchClosedOrders(Market)
    }else{
      tradeHistory = await this.exchange.fetchMyTrades(Market)
    }

    tradeHistory = tradeHistory.filter(e=> e.status != 'canceled')
    tradeHistory = tradeHistory.reverse(); 
    return  {Data:Object.keys(tradeHistory).map(key => this.CommonFormat('tradeHistory', tradeHistory[key]))}
  }

  async GetTransactions (Type, Count) {
    return await this._private('GetTransactions', { Type, Count }).catch(e => console.log(e))
  }

  async SubmitTrade (Market, TradePairId, Type, Rate, Amount) {

    if(this.exchangeId == 'okex' || this.exchangeId == 'hitbtc'){
      Type = Type.replace('Buy','buy').replace('Sell','sell')
    }
    
    var result = await this.exchange.createOrder(Market, 'limit', Type, Amount, Rate);
    
    return  { "Success": result.id ? true : false,
              "Error": result.id ? null : 'Hata var mhtCcxt.js Line: 88',
              Data: { OrderId: result.id, "FilledOrders": result.filled }
            }
  }

  async CancelTrade (OrderId, Market) {
    return await this.exchange.cancelOrder(OrderId, Market)
  }

  async SubmitTip (Currency, ActiveUsers, Amount) {
    return await this._private('SubmitTip', { Currency, ActiveUsers, Amount }).catch(e => console.log(e))
  }

  async SubmitWithdraw (Currency, Address, PaymentId, Amount) {
    return await this._private('SubmitWithdraw', { Currency, Address, PaymentId, Amount }).catch(e => console.log(e))
  }

  async SubmitTransfer (Currency, Username, Amount) {
    return await this._private('SubmitTransfer', { Currency, Username, Amount }).catch(e => console.log(e))
  }

  async GetYobitMarkets (symbols) {
    if(!symbols){
      return console.log('Yobit Marketi için ')
    }

    let coinler = []
    let tickerUrls = []
    symbols.forEach((e, idx, array) => {
      if (coinler.length > 50) {
        tickerUrls.push(coinler)
        coinler = []
      }
      coinler.push(e)
      if (idx === array.length - 1) {  // Eğer son kayıt ise
        tickerUrls.push(coinler)
      }
    })

    let allMarkets = []
    for (let tickerUrl of tickerUrls) {
      await this.exchange.fetchTickers (tickerUrl).then(markets => {
        Object.keys(markets).forEach(key => {
          const guncelMarket = this.CommonFormat('market', markets[key])
          allMarkets.push(guncelMarket)
        })
      }).catch(e => {
        console.log(e)
      })
    }

    this.markets = allMarkets
    return allMarkets
  }

  CommonFormat(type, data) {
    switch (type) {
      case 'market':
       return {
          TradePairId: data.info.TradePairId || null,
          AskPrice: data.ask,
          BidPrice: data.bid,
          High: data.high,
          Label: data.symbol,
          LastPrice: data.last,
          Low: data.low,
          Change: data.change || null,
          Volume: data.bid * data.baseVolume, //BTCVOLUME
        }
      break;
      case 'balance':
        return {
          "Symbol": data.symbol, 
          "Total": data.balance.total,
          "Available": data.balance.free,
          "Status": "OK"
        } 
      break;
      case 'orderBook':
     // return Object.keys(response).map(key => this.CommonFormat('orderBook', {market: key, orderBook: response[key]}))
        data.orderBook.asks = data.orderBook.asks.map(e=> {
          return {Price: e[0], Amount: e[1]}
        })
        data.orderBook.bids = data.orderBook.bids.map(e=> { return {Price: e[0], Amount: e[1]} })
    
        return {
          "Market": data.market,
          "Buy": data.orderBook.bids,
          "Sell" : data.orderBook.asks,
        }
      break;
      case 'tradeHistory':
        return  {
          "Market": data.symbol,
          "TradeId": data.id,
          "Type": data.side.replace(/\b\w/g, l => l.toUpperCase()),
          "Rate": data.price,
          "Amount": data.amount,
          "Total": (data.price * data.amount).toFixed(8),
          "DateTime": data.datetime
         }
      break;
      case 'orders':
        return {
          "OrderId": data.id,
          "Market": data.symbol,
          "Type": data.side,
          "Rate": data.price,
          "Amount": data.remaining,
          "Remaining": data.remaining    
        }
        break;
      default:
        break;
    }

  }
}

module.exports = MhtCcxt
