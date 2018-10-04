# -*- coding: utf-8 -*-
import pyrebase
import requests
import numpy as np
import sys
import uuid
import ccxt
import pymongo
try:    
    import thread 
except ImportError:
    import _thread as thread #Py3K changed it.

myclient = pymongo.MongoClient("mongodb://209.250.238.100:27017/")
mydb = myclient["cry"]
mycol = mydb["depths"]

''' hasip4441
    'apiKey': 'aa903e0b70544955b414d33d987bfe2f',
    'secret': '8i3GoHxNRvCMticaKj++sBt4H2BI1WLUtVX6UsY1Ycs=',
'''
ccx  = ccxt.cryptopia({
  'api_key':'dbec90fd39294e1fa90db54e404c2edc',
  'secret': 'D3tx+b8gb3Me2z3T/D/gzMdRWfNbR9vfYyf/RiqdJzc='
})

config = {
  "apiKey": "apiKey",
  "authDomain": "firem-b3432",
  "databaseURL": "https://firem-b3432.firebaseio.com",
  "storageBucket": "firem-b3432.appspot.com",
  "serviceAccount": "firebase.json"
}

firebase = pyrebase.initialize_app(config)

minFark = 2 # ----> MİN FARK
auth = firebase.auth()
db = firebase.database()
mainMarkets = ["BTC", "LTC", "DOGE"]
islemdekiCoinler = []
limits = {"BTC": 0.0006, "ETH": 0.011, "LTC": 0.051, "DOGE": 1250, "BNB":5.1, "USD":100, "USDT":100}
limitsForBuy = {"BTC": 0.0006, "ETH": 0.011, "LTC": 0.051, "DOGE": 1250, "BNB":5.1, "USD":40, "USDT":40}

def stream_handler(message):
    coin = message["data"]
    if coin not in mainMarkets and coin not in islemdekiCoinler:
      thread.start_new_thread(FiyatFarkKontrolYeni, (coin, 'BTC', 'LTC', 'DOGE'))

db.child('cry/ws').stream(stream_handler)

def FiyatFarkKontrolYeni(coin, fmc, smc, tmc):
    global islemdekiCoinler
    islemdekiCoinler.append(coin)
    print(coin + ' Girdi', islemdekiCoinler)
    MarketHazirla(coin, fmc, smc,'ust', tmc, 'ust') # BTC, LTC, DOGE
    MarketHazirla(coin, smc, fmc,'alt', tmc, 'ust') # LTC, BTC, DOGE
    MarketHazirla(coin, tmc, fmc,'alt', smc, 'alt') # DOGE, BTC, LTC
    islemdekiCoinler = list(filter(lambda x : x != coin ,islemdekiCoinler))
    print(coin + ' Çıktı', islemdekiCoinler)

def MarketHazirla(coin, fmc, smc, smct, tmc, tmct):
    MarketeGir(coin, fmc, smc, smct)
    MarketeGir(coin, fmc, tmc, tmct)

def MarketeGir(coin, firstMainCoin, secondMainCoin, type):
    dict = {'minFark': minFark,  
      'coin': coin,
      'firstMainCoin': firstMainCoin,
      'secondMainCoin': secondMainCoin,
      'type': type,
      'firstMarketName': coin + '/' + firstMainCoin,
      'secondMarketName': coin + '/' + secondMainCoin,
      'thirdMarketName': firstMainCoin  + '/' + secondMainCoin if type == 'alt' else secondMainCoin + '/' + firstMainCoin,
      'btcMarketName': coin + '/' + 'BTC'
    }

    MarketKontrolveEkle(dict)

def MarketKontrolveEkle(d):
    rob = GetOrderBookGroup(d) # result order book yani rob

    if(not rob or not rob['firstOrderBook'] or not rob['secondOrderBook'] or not rob['thirdOrderBook']):
      return 

    #rk yani result kontrol
    rk = Kontrol(d, rob['firstOrderBook'][0]['Price'], rob['secondOrderBook'][0]['Price'], rob['thirdOrderBook'][0]['Price'])

    if rk['sonuc']:
      UygunMarketEkle(rk, d, rob)

def Kontrol(d, firstPrice, secondPrice, thirdPrice):
    ourTotal = limits[d['firstMainCoin']]
    firstMarketAmount = ourTotal / float(firstPrice) # first market amount' u aldık.
    if(np.isinf(firstMarketAmount)): # infinity ise çık
      return False 
    secondMarketTotal = firstMarketAmount * secondPrice # totalimizi aldık. second market total.
    thirdMarketTotal = secondMarketTotal / thirdPrice if d['type'] == 'alt' else secondMarketTotal * thirdPrice # alt ise böy, üst se çarp
    kar = thirdMarketTotal - ourTotal # elde edilen doge ile 10.000 doge arasındaki farka bakıyor. kâr.
    fark = kar / ourTotal * 100
    sonuc = fark >= d['minFark']
    return {'kar': kar, 'fark': fark, 'thirdMarketTotal': thirdMarketTotal, 'sonuc': sonuc}
    
def UygunMarketEkle(rk, d, rob):
    uygunMarket = {
      'id': str(uuid.uuid4()),
      'fark': rk['fark'],
      'kar': rk['kar'],
      'firstMarket': { 
          'name': d['firstMarketName'], 
          'askPrice': rob['firstOrderBook'][0]['Price'], 
          'orderBook': rob['firstOrderBook']},
      'secondMarket': { 
          'name': d['secondMarketName'], 
          'bidPrice': rob['secondOrderBook'][0]['Price'], 
          'orderBook': rob['secondOrderBook']},
      'thirdMarket': { 
          'name': d['thirdMarketName'], 
          'askPrice': rob['thirdOrderBook'][0]['Price'], 
          'orderBook': rob['thirdOrderBook'], 
          'amount': rk['thirdMarketTotal'], 
          'type': d['type'] }
    }

    result = CheckTamUygun(d, rob)

    if result:
      print('Buy Sell Başla')
      BuySellBasla(uygunMarket)
 
def GetOrderBookGroup(d):
    marketList = [ d['firstMarketName'], d['secondMarketName'], d['thirdMarketName'], d['btcMarketName'] ]
    orderBooks = mycol.find( { 'market': { '$in': marketList } } )# orderBooku tekrar alıyoruz.
    orderBooksCount = orderBooks.count()
    
    if orderBooksCount < 3: # Eğer 3 dayıt yoksa false döndür
      return False
    orderBooks = list(orderBooks)

    firstOrderBook = findInDepths(orderBooks, d['firstMarketName'])
    secondOrderBook = findInDepths(orderBooks, d['secondMarketName'])
    thirdOrderBook = findInDepths(orderBooks, d['thirdMarketName'])
    btcOrderBook = findInDepths(orderBooks, d['btcMarketName'])    

    # coinin btc değeri, sell 1 satoshi ise buy yoktur veya buy varsa ve 22 den küçükse boş dön.    
    if float(btcOrderBook['asks'][0][0]) == 0.00000001:
      return False

    if float(btcOrderBook['bids'][0][0]) < 0.00000022:
      return False

    firstOrderBook = [{"Price": float(firstOrderBook['asks'][0][0]),"Total": float(firstOrderBook['asks'][0][0]) * float(firstOrderBook['asks'][0][1])}]
    secondOrderBook = [{"Price": float(secondOrderBook['bids'][0][0]),"Total": float(secondOrderBook['bids'][0][0]) * float(secondOrderBook['bids'][0][1])}]

    if d['type'] == 'alt':
        thirdOrderBook = [{"Price": float(thirdOrderBook['asks'][0][0]),"Total": float(thirdOrderBook['asks'][0][0]) * float(thirdOrderBook['asks'][0][1])}]
    else:
        if 'DOGE' in d['thirdMarketName']:
          thirdOrderBook = [{"Price": float(thirdOrderBook['bids'][0][0]),"Total": float(thirdOrderBook['bids'][0][0]) * float(thirdOrderBook['bids'][0][1])}]
        else:
          thirdOrderBook = [{"Price": float(thirdOrderBook['asks'][0][0]),"Total": float(thirdOrderBook['asks'][0][0]) * float(thirdOrderBook['asks'][0][1])}]
  
    return {'firstOrderBook': firstOrderBook, 'secondOrderBook': secondOrderBook, 'thirdOrderBook': thirdOrderBook}

def CheckTamUygun(d, rob):
    firstMarketUygun = rob['firstOrderBook'][0]['Total']  >= limits[d['firstMainCoin']]
    secondMarketUygun = rob['secondOrderBook'][0]['Total'] >= limits[d['secondMainCoin']]
    if firstMarketUygun and secondMarketUygun: # iki marketinde min tutarları uyuyorsa true döndür.
      return True
    else:
      return False
def findInDepths(depths, market):
  for i in depths:
    if i['market'] == market:
      return i['depths']




# BUY SELL BAŞLA           ###############################           BUY SELL BAŞLA        ###############################

def BuySellBasla(market):
    #db.child("cry/tam-uygun-py").push(market)
    firstMarket = market['firstMarket']
    secondMarket = market['secondMarket']
    #thirdMarket = market['thirdMarket']
    firstCoin = firstMarket['name'].split('/')[1]
    amount = 0
    total = 0
    firstAmount = round(firstMarket['orderBook'][0]['Total'] / firstMarket['orderBook'][0]['Price'], 8) # tofixed yerine round
    secondAmount = round(secondMarket['orderBook'][0]['Total'] / secondMarket['orderBook'][0]['Price'], 8) # tofixed yerine round

    if firstAmount < secondAmount:
      amount = firstAmount
      total = secondMarket['orderBook'][0]['Total']
    else:
      amount = secondAmount
      total = secondMarket['orderBook'][0]['Total']
    
    barajTotal = limitsForBuy[firstCoin] * 10

    if total > barajTotal:
      amount = round(barajTotal / firstMarket['orderBook'][0]['Price'], 8)
    
    usdtOrderBook = mycol.find_one( { 'market': market['coin'] + '/USDT'} )
    usdtPrice = float(usdtOrderBook['asks'][0][0])
    balances = ccx.fetch_balance()

    if balances[market['coin']]['total'] * usdtPrice > limits['USDT']:
        return

    firstMarketName = firstMarket['name']

    buyResult = Submit(market, firstMarketName, firstMarket['orderBook'][0]['Price'], amount, 'Buy')

    if buyResult:
      sellResult = None
      sellIptalResult = None

      if buyResult['filled'] > 0:
        sellResult = Submit(market, secondMarket['name'], secondMarket['orderBook'][0]['Price'], buyResult['filled'], 'Sell')
        if sellResult and sellResult['filled'] < buyResult['filled']:
          sellIptalResult = OrderIptalEt(sellResult)
      
      buyIptalResult = None
      if buyResult['filled'] < amount:
        buyIptalResult = OrderIptalEt(buyResult)
        
      mailDatam = {'firstMarket': firstMarketName,
                  'secondMarket': secondMarket['name'],
                  'uygunMarket': market,
                  'buyAmount': amount,
                  'sellAmount': buyResult['filled'] if buyResult['filled'] else 0,
                  'buyResult': buyResult,
                  'sellResult': sellResult,
                  'sellIptalResult': sellIptalResult,
                  'buyIptalResult': buyIptalResult}

      db.child('cry/mailDatam').push(mailDatam)
      print('##############################     BİR İŞLEM OLDU     ##############################')
    else:
      mailDatam = {'firstMarket': firstMarketName,
                  'secondMarket': secondMarket['name'],
                  'uygunMarket': market,
                  'buyAmount': amount}
      db.child('cry/mailDatam-buy-hata').push(mailDatam)

def Submit(market, marketName, rate, amount, type):
    submitOrder = None
    try:
      submitOrder = ccx.create_order(marketName, 'limit', type, amount, rate)
      #db.child('cry/tam-uygun-py').push(market)
    except Exception as e:
      print(e)
      market['Hata'] = str(e)
      db.child('cry/tam-uygun-hatali-py').push(market)

    if submitOrder:
        print(marketName + ' için ' + type + ' Kuruldu.')
        return submitOrder
    else:
        print(type + ' Kurrarken Hata! market:' + marketName )
        return False

def OrderIptalEt(order):
    result = None
    try:
      result = ccx.cancel_order(order['id'], order['symbol'])
    except:
      pass
    return result

# ELDE KALANLAR
