# -*- coding: utf-8 -*-
import pyrebase
import requests
import numpy as np
import sys
import uuid
import ccxt
import pymongo
import json
import websocket
import time
import urllib
from datetime import datetime
try:    
    import thread 
except ImportError:
    import _thread as thread #Py3K changed it.

import threading

#pip3 install websocket-client pyrebase numpy ccxt pymongo
myclient = pymongo.MongoClient("mongodb://45.76.71.83:1453/")
mydb = myclient["cry"]
myColDepths = mydb["ws-depths"]
myColWsDepths = mydb["ws-depths"]
myColBalances = mydb["balances"]
myColHistory = mydb["history"]

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


islemKati = 10
minFark = 2 # ----> MİN FARK
#minFark = -10 # TEST
app = ''
auth = firebase.auth()
db = firebase.database()
mainMarkets = ["BTC", "LTC", "DOGE"]
islemdekiCoinler = []
limits = {"BTC": 0.0006, "ETH": 0.011, "LTC": 0.06, "DOGE": 700, "BNB":5.1, "USD":100, "USDT":100}
limitsForBuy = {"BTC": 0.0006, "ETH": 0.011, "LTC": 0.06, "DOGE": 1250, "BNB":5.1, "USD":40, "USDT":40}
cryWsToken = ''
ws = None
uygunMarkets = []
steamBasla = False
def stream_handler(coin):
    global islemdekiCoinler, mainMarkets
    if coin not in mainMarkets and coin not in islemdekiCoinler:
      thread.start_new_thread(FiyatFarkKontrolYeni, (coin, 'BTC', 'LTC', 'DOGE'))

def FiyatFarkKontrolYeni(coin, fmc, smc, tmc):
    global islemdekiCoinler
    islemdekiCoinler.append(coin)
    print(coin + ' Girdi', islemdekiCoinler)
    MarketHazirla(coin, fmc, smc,'ust', tmc, 'ust') # BTC, LTC, DOGE
    MarketHazirla(coin, smc, fmc,'alt', tmc, 'ust') # LTC, BTC, DOGE
    MarketHazirla(coin, tmc, fmc,'alt', smc, 'alt') # DOGE, BTC, LTC
    islemdekiCoinler = list(filter(lambda x : x != coin ,islemdekiCoinler))
    #print(coin + ' Çıktı', islemdekiCoinler)

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
    
    if rk['fark'] > 0:
      print(rk['fark'])

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
          'type': d['type'] },
      'btcMarket': {
          'askPrice': rob['btcOrderBook'][0]['Price'] }
    }

    result = CheckTamUygun(d, rob)

    if result:
      print('Buy Sell Başla')
      BuySellBasla(uygunMarket)
 
def GetOrderBookGroup(d):
    marketList = [ d['firstMarketName'], d['secondMarketName'], d['thirdMarketName'], d['btcMarketName'] ]
    orderBooks = myColDepths.find( { 'market': { '$in': marketList } } )# orderBooku tekrar alıyoruz.
    orderBooksCount = orderBooks.count()
    
    if orderBooksCount < 3: # Eğer 3 dayıt yoksa false döndür
      return False
    orderBooks = list(orderBooks)

    firstOrderBook = findInDepths(orderBooks, d['firstMarketName'])
    secondOrderBook = findInDepths(orderBooks, d['secondMarketName'])
    thirdOrderBook = findInDepths(orderBooks, d['thirdMarketName'])
    btcOrderBook = findInDepths(orderBooks, d['btcMarketName'])    

    if not firstOrderBook or not secondOrderBook or not thirdOrderBook or not btcOrderBook:
      return False

    # coinin btc değeri, sell 1 satoshi ise buy yoktur veya buy varsa ve 22 den küçükse boş dön.    
    if float(btcOrderBook['asks'][0]['rate']) == 0.00000001:
      return False

    if float(btcOrderBook['bids'][0]['rate']) < 0.00000022:
      return False

    
       
    firstOrderBook = [{"Price": float(firstOrderBook['asks'][0]['rate']),"Total": float(firstOrderBook['asks'][0]['rate']) * float(firstOrderBook['asks'][0]['amount'])}]
    secondOrderBook = [{"Price": float(secondOrderBook['bids'][0]['rate']),"Total": float(secondOrderBook['bids'][0]['rate']) * float(secondOrderBook['bids'][0]['amount'])}]
    btcOrderBook = [{"Price": float(btcOrderBook['asks'][0]['rate']),"Total": float(btcOrderBook['asks'][0]['rate']) * float(btcOrderBook['asks'][0]['amount'])}]

    if d['type'] == 'alt':
        thirdOrderBook = [{"Price": float(thirdOrderBook['asks'][0]['rate']),"Total": float(thirdOrderBook['asks'][0]['rate']) * float(thirdOrderBook['asks'][0]['amount'])}]
    else:
        if 'DOGE' in d['thirdMarketName']:
          thirdOrderBook = [{"Price": float(thirdOrderBook['bids'][0]['rate']),"Total": float(thirdOrderBook['bids'][0]['rate']) * float(thirdOrderBook['bids'][0]['amount'])}]
        else:
          thirdOrderBook = [{"Price": float(thirdOrderBook['asks'][0]['rate']),"Total": float(thirdOrderBook['asks'][0]['rate']) * float(thirdOrderBook['asks'][0]['amount'])}]
  
    return {'firstOrderBook': firstOrderBook, 'secondOrderBook': secondOrderBook, 'thirdOrderBook': thirdOrderBook, 'btcOrderBook': btcOrderBook }

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
    firstMarket = market['firstMarket']
    secondMarket = market['secondMarket']
    btcMarket = market['btcMarket']
    #thirdMarket = market['thirdMarket']
    baseCoin = firstMarket['name'].split('/')[1]
    altCoin = firstMarket['name'].split('/')[0]
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
    
    barajTotal = limitsForBuy[baseCoin] * islemKati

    if total > barajTotal:
        amount = round(barajTotal / firstMarket['orderBook'][0]['Price'], 8)
    
    balanceVar = BalanceKontrol(btcMarket['askPrice'], altCoin)
    if balanceVar:
        print('Yeterince balance var. ÇIK', altCoin)
        return

    '''
    balance = myColBalances.find_one( { 'Symbol': altCoin })# orderBooku tekrar alıyoruz.
    if balance: # BALANCE VARSA kontrol et yeterince varsa dön.
      altCoinTotal = balance['Total']
      altCoinBtcDegeri = altCoinTotal * btcMarket['askPrice']
      balanceVar = altCoinBtcDegeri > limits['BTC']
      if balanceVar:
        print('Yeterince balance var. ÇIK', altCoin)
        return
    '''

    firstMarketName = firstMarket['name']
    buyResult = Submit(market, firstMarketName, firstMarket['orderBook'][0]['Price'], amount, 'Buy')

    if buyResult:
      sellResult = None
      sellIptalResult = None

      if buyResult['filled'] > 0:
        sellResult = Submit(market, secondMarket['name'], secondMarket['orderBook'][0]['Price'], buyResult['filled'], 'Sell')
        if sellResult and sellResult['filled'] < buyResult['filled']:
          sellIptalResult = OrderIptalEt(sellResult)
          kalanAmount = buyResult['filled'] - sellResult['filled']
          HistoryEkle(altCoin, kalanAmount, btcMarket['askPrice'])
      
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
                    'buyIptalResult': buyIptalResult,
                    'date': datetime.now() }
      mydb["mailData"].insert_one(mailDatam)
      #db.child('cry/' + app + '-mailDatam').push(mailDatam)
      print('##############################     BİR İŞLEM OLDU     ##############################')
    else:
      mailDatam = {'firstMarket': firstMarketName,
                    'secondMarket': secondMarket['name'],
                    'uygunMarket': market,
                    'buyAmount': amount,
                    'date': datetime.now() }
      mydb["mailData"].insert_one(mailDatam)
      #db.child('cry/' + app + '-mailDatam-buy-hata').push(mailDatam)

def HistoryEkle(altCoin, amount, btcAskPrice ):
    myColHistory.delete_many({'coin': altCoin})
    myColHistory.insert_one({'coin': altCoin, 'amount': amount, 'btcPrice': btcAskPrice, 'date': datetime.now() })


def BalanceKontrol(anaCoinPrice, altCoin):
    balances = ccx.fetch_balance()
    altCoinTotal = balances[altCoin]['total']
    altCoinBtcDegeri = altCoinTotal * anaCoinPrice
    return altCoinBtcDegeri > limits['BTC']

def BalanceKontrolFb(anaCoinPrice, altCoin):
    balance = myColBalances.find_one( { 'Symbol': altCoin })# orderBooku tekrar alıyoruz.
    if not balance:
      return False # yani balance yok demek.

    altCoinTotal = balance['Total']
    altCoinBtcDegeri = altCoinTotal * anaCoinPrice
    return altCoinBtcDegeri > limits['BTC']


def Submit(market, marketName, rate, amount, type):
    submitOrder = None
    try:
      submitOrder = ccx.create_order(marketName, 'limit', type, amount, rate)
    except Exception as e:
      print(e)
      market['Hata'] = str(e)
      market['date'] = datetime.now()
      mydb["mailData-hata"].insert_one(market)
      #db.child('cry/' + app + '-tam-uygun-hatali-py').push(market)

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

# WEBSOKET


def WebSocketleBaslat():
    timeMiliSecond = int(round(time.time() * 1000))
    fullUrl = 'https://www.cryptopia.co.nz/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&_=' + str(timeMiliSecond)
    token = None
    r = requests.get(fullUrl)
    result = r.json()
    token = result['ConnectionToken']
    token = urllib.parse.quote_plus(token)

    wsUrl = 'wss://www.cryptopia.co.nz/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&tid=7&connectionToken=' + token

    def on_message(ws, msg):
        data = json.loads(msg)
        if not data:
          return

        if 'S' in data:
          return
        if data['M'][0]['M'] == 'SendTradeDataUpdate':
          coin = data['M'][0]['A'][0]['Market'].split('_')[0]
          stream_handler(coin)
            
    def on_error(ws, error):
        print(error)

    def on_close(ws):
        print("### closed ###")

    websocket.enableTrace(True)
    ws = websocket.WebSocketApp(wsUrl, on_message = on_message, on_error = on_error, on_close = on_close)
    ws.run_forever()
    
#stream_handler('ADA')
#WebSocketleBaslat()

def PrepareDbAndGetUygunMarkets():
    allmarkets = []
    try:
      allmarkets = ccx.fetch_tickers()
    except:
      PrepareDbAndGetUygunMarkets()
      return
    
    
    def allMarketsFilter(x):
        coin = x.split('/')[0]
        marketBtc = coin + '/BTC'
        marketLtc = coin + '/LTC'
        marketDoge = coin + '/DOGE'
        allmarkets[x]['TradePairId'] = allmarkets[x]['info']['TradePairId']
        allmarkets[x]['info'] = None
        mainMarkets = ['LTC/BTC', 'DOGE/LTC', 'DOGE/BTC']
        if x in mainMarkets:
          return True

        if marketBtc in allmarkets and marketLtc in allmarkets and marketDoge in allmarkets and allmarkets[x]['quoteVolume'] > 0.1:
            return True
        else:
            return False

    def allMarketsMap(x):
        return allmarkets[x]

    umFilter = list(filter(allMarketsFilter, allmarkets))
    umMap = list(map(allMarketsMap, umFilter))
    '''
    def depthsMap (x):
        dict = {
            'tradePairId': x['TradePairId'],
            'market': x['symbol'],
            'depths': { 'bids': [], 'asks': []}
        }
        return dict


    depths = list(map(depthsMap, umMap))
    myColWsDepths.delete_many({})
    myColWsDepths.insert_many(depths)
    '''
    return umMap

'''
def WebSocketleBaslatWsDepth(tradePairId, symbol):
    global cryWsToken

    DbOrderbookDoldur(tradePairId)
    wsUrl = 'wss://www.cryptopia.co.nz/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&tid=7&connectionToken=' + cryWsToken
    orderBookMessage = '{"H":"notificationhub","M":"SetTradePairSubscription","A":[' + str(tradePairId) + ',null],"I":0}'

    def on_message(ws, msg):
        data = json.loads(msg)
        if not data:
          return

        if 'S' in data or 'I' in data or 'G' in data:
          return

        for dataM in data['M']:
          if dataM['M'] == 'SendTradeDataUpdate':
            datam = dataM['A']
            actions = list(filter(lambda x: 'Action' in x, list(datam)))

            if len(actions) == 0:
              return

            if len(actions) > 1:
              print('################## Birden Fazla Acion lu data var!!!!!!!!!! ##################')
            
            for action in actions:
              OrderBookInsert(action, symbol)
            

            
    def on_error(ws, error):
        print(error)
        
    def on_open(ws):
        ws.send(orderBookMessage)

    def on_close(ws):
        print("### closed ###")

    websocket.enableTrace(True)
    ws = websocket.WebSocketApp(wsUrl, on_message = on_message, on_error = on_error, on_close = on_close, on_open = on_open)
    ws.run_forever()
'''
def OrderBookInsert(data):
    global uygunMarkets, steamBasla
    '''
    Action: 3
    Amount: 1.74837072
    DataType: 0
    Rate: 0.00826704
    Total: 0.020000000017998
    TradePairId: 101
    Type: 1
    UserId: null
    '''
    
    depths = myColWsDepths.find_one({ 'tradePairId': data['TradePairId'] })

    bids = []
    asks = []
    if not depths or 'bids' not in depths['depths']:
        return

    if len(depths['depths']['bids']) > 0:
        bids = depths['depths']['bids']

    if len(depths['depths']['asks']) > 0:
        asks = depths['depths']['asks']

    mix = bids+asks
    if data['Action'] == 0: # add
        mix = OrderEkle(data, mix)
    
    if data['Action'] == 3: # sil (iptal)
        mix = OrderSil(data, mix)

    if data['Action'] == 1: # sil (işlem yapıldı buy yada sell)
        mix = OrderSil(data, mix)


    asks = list(filter(lambda x: x['type'] == 'asks', mix))
    asks = sorted(asks, key=lambda x: x['rate'])

    bids = list(filter(lambda x: x['type'] == 'bids', mix))
    bids = sorted(bids, key=lambda x: x['rate'],  reverse=True)
    '''
    newDepths = {'bids': bids[:10], 'asks': asks[:10] }

    myColWsDepths.update_one({'tradePairId': data['TradePairId']}, {'$set': {'depths': newDepths}})
    '''
    if data['Action'] == 0: #and steamBasla:
        ratem = list(filter(lambda x: x['rate'] == data['Rate'], mix ))
        if len(ratem) == 0 : return
        indexim = -1
        if data['Type'] == 1: # sell 
            indexim = [x['rate'] for x in asks].index(data['Rate'])
        else:
            indexim = [x['rate'] for x in bids].index(data['Rate'])

        if indexim == 0:
            uygunMarket = list(filter(lambda x: x['TradePairId'] == data['TradePairId'], uygunMarkets))
            coin = uygunMarket[0]['symbol'].split('/')[0]
            stream_handler(coin)
    

def OrderEkle(data, orderBooks):
    rateExist = list(filter(lambda x: x['rate'] == data['Rate'],orderBooks))
    if len(rateExist) > 0:
      rateExist[0]['amount'] = rateExist[0]['amount'] + data['Amount']
      rateExist[0]['amount'] = float("{0:.8f}".format(rateExist[0]['amount']))
      orderBooks = list(filter(lambda x: x['rate'] != rateExist[0]['rate'], orderBooks))
      orderBooks.append(rateExist[0])
    else:
      typem = 'asks' if data['Type'] == 1 else 'bids'
      orderBooks.append({'rate': data['Rate'], 'amount': data['Amount'], 'type': typem })

    return orderBooks

def OrderSil(data, orderBooks):
    if len(orderBooks) > 0:
      onceLen = len(orderBooks)
      rateExist = list(filter(lambda x: x['rate'] == data['Rate'],orderBooks))
      if len(rateExist) > 0:
        onceAmount = rateExist[0]['amount']
        rateExist[0]['amount'] = rateExist[0]['amount'] - data['Amount']
        rateExist[0]['amount'] = float("{0:.8f}".format(rateExist[0]['amount']))
        if rateExist[0]['amount'] > 0:
          orderBooks = list(filter(lambda x: x['rate'] != rateExist[0]['rate'], orderBooks))
          orderBooks.append(rateExist[0])
        else:
          orderBooks = list(filter(lambda x: x['rate'] != rateExist[0]['rate'], orderBooks))

        sonraLen = len(orderBooks)
        if onceLen == sonraLen and onceAmount == data['Amount']:
          print('huhu')
     
    return orderBooks



def DbOrderbookDoldur(tradePairId):
    global cryWsToken
    fullUrl = 'https://www.cryptopia.co.nz/api/GetMarketOrders/'+str(tradePairId)+'/10'
    r = requests.get(fullUrl)
    result = r.json()
    data = result['Data']

    def depthsMapBuy(x):
        return {
          'rate': x['Price'],
          'amount': x['Volume'],
          'type': 'bids' }
    
    def depthsMapSell(x):
        return {
          'rate': x['Price'],
          'amount': x['Volume'],
          'type': 'asks' }

    buys = list(map(depthsMapBuy, data['Buy']))
    sells = list(map(depthsMapSell, data['Sell']))
    depths = {
      'bids': buys,
      'asks': sells,
      'tradePairId': tradePairId
    }
    myColWsDepths.update_one({'tradePairId': tradePairId}, {'$set': {'depths': depths}})

# WEBSOCKET

def on_message(ws, msg):
    data = json.loads(msg)
    if not data:
      return

    if 'S' in data or 'I' in data or 'G' in data:
      return

    for dataM in data['M']:
      if dataM['M'] == 'SendTradeDataUpdate':
        datam = dataM['A']
        actions = list(filter(lambda x: 'Action' in x, list(datam)))

        if len(actions) == 0:
          return

        if len(actions) > 1:
          print('################## Birden Fazla Acion lu data var!!!!!!!!!! ##################')
            
        for action in actions:
          OrderBookInsert(action)
            

            
def on_error(ws, error):
    print(error)
        
def on_open(ws):
    print('ws opened')
    #ws.send(orderBookMessage)

def on_close(ws):
    print("### closed ###")
    '''
    print("10 Saniye sonra tekrar başlıyor.")
    time.sleep(10)
    threading.Thread(target=Basla).start()
    '''
    

def SetCryWsToken():
    global cryWsToken, ws
    timeMiliSecond = int(round(time.time() * 1000))
    fullUrl = 'https://www.cryptopia.co.nz/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&_=' + str(timeMiliSecond)
    token = None
    r = requests.get(fullUrl)
    result = r.json()
    token = result['ConnectionToken']
    cryWsToken = urllib.parse.quote_plus(token)

    wsUrl = 'wss://www.cryptopia.co.nz/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&tid=7&connectionToken=' + cryWsToken
    
    websocket.enableTrace(True)
    ws = websocket.WebSocketApp(wsUrl, on_message = on_message, on_error = on_error, on_close = on_close, on_open = on_open)
    wst = threading.Thread(target=ws.run_forever)
    wst.daemon = True
    wst.start()

    #ws.run_forever()



def WsSubEkle(tradePairId):
    global ws
    #DbOrderbookDoldur(tradePairId)
    orderBookMessage = '{"H":"notificationhub","M":"SetTradePairSubscription","A":[' + str(tradePairId) + ',null],"I":0}'
    ws.send(orderBookMessage)
  
def Basla():
    #time.sleep(60*2)
    global ws, uygunMarkets, steamBasla
    if ws:
        ws.close()

    SetCryWsToken()
    uygunMarkets = PrepareDbAndGetUygunMarkets()
    #WsSubEkle(5664)
    for i in uygunMarkets:
      WsSubEkle(i['TradePairId']) # 101

    steamBasla = True
    ready = threading.Event()
    ready.wait()

def set_interval(func, sec):
    def func_wrapper():
        set_interval(func, sec)
        func()
    t = threading.Timer(sec, func_wrapper)
    t.start()
    return t

Basla()
set_interval(Basla, 3720) # 1 saat 2 dakika
#WebSocketleBaslat()

