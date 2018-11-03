# -*- coding: utf-8 -*-
import pyrebase
import requests
import ccxt
import pymongo
import json
import websocket
import time
import urllib
import threading
import numpy as np
import datetime

#pip3 install websocket-client pyrebase numpy ccxt pymongo
myclient = pymongo.MongoClient("mongodb://45.76.71.83:1453/")
mydb = myclient["cry"]
myColWsDepths = mydb["ws-depths"]
ccx  = ccxt.cryptopia({ 'api_key':'dbec90fd39294e1fa90db54e404c2edc', 'secret': 'D3tx+b8gb3Me2z3T/D/gzMdRWfNbR9vfYyf/RiqdJzc=' })
ws = None
sayac = 0

def GetCcxData(funk, param):
    data = None
    try:
      if funk == 'tickers':
        data = ccx.fetch_tickers()
      elif funk == 'orderbooks':
        data = ccx.fetch_order_books(param)

      return data
    except Exception as e:
      print(str(e))
      print('GetCcxData hata verdi 3 saniye sonra tekrar deneyecek.')
      time.sleep(3)
      return GetCcxData(funk, param)
      

# WEBSOKET
def PrepareDbAndGetUygunMarkets():
    allTickers = GetCcxData('tickers',None)
    
    def allTickersFilter(x):
        coin = x.split('/')[0]
        baseCoin = x.split('/')[1]
        marketBtc = coin + '/BTC'
        marketLtc = coin + '/LTC'
        marketDoge = coin + '/DOGE'
        allTickers[x]['TradePairId'] = allTickers[x]['info']['TradePairId']
        allTickers[x]['info'] = None
        mainMarkets = ['LTC/BTC', 'DOGE/LTC', 'DOGE/BTC']
        market = allTickers[x]
        if x in mainMarkets:
          return True

        if x == 'POT/LTC':
          a = 1

        if baseCoin in ['USTD', 'NZDT']:
          return False

        if marketBtc in allTickers and marketLtc in allTickers and marketDoge in allTickers and market['quoteVolume'] > 0.01:
            return True
        else:
            return False

    def allTickersMap(x):
        return allTickers[x]

    umFilter = list(filter(allTickersFilter, allTickers))
    umMap = list(map(allTickersMap, umFilter))

    def depthsMap (x):
        dict = {
            'tradePairId': x['TradePairId'],
            'market': x['symbol'],
            #'depths': { 'bids': [], 'asks': []}
        }
        return dict

    print(str(len(umMap)))
    depths = list(map(depthsMap, umMap))
    myColWsDepths.delete_many({})
    myColWsDepths.insert_many(depths)
    return umMap

def OrderBookInsert(data):
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

    newDepths = {'bids': bids[:5], 'asks': asks[:5] }

    myColWsDepths.update_one({'tradePairId': data['TradePairId']}, {'$set': {'depths': newDepths}})
    

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



def DbOrderbookDoldurBesMarkets(besMarkets):
  
    marketNames = []
    for i in besMarkets:
      marketNames.append(i['symbol'])

    besOrderBooks = GetCcxData('orderbooks',marketNames)

    def depthsMapBuy(x):
        return {
          'rate': x[0],
          'amount': x[1],
          'type': 'bids' }
    
    def depthsMapSell(x):
        return {
          'rate': x[0],
          'amount': x[1],
          'type': 'asks' }

    for i in besOrderBooks:
      market = besOrderBooks[i]
      buys = list(map(depthsMapBuy, market['bids']))
      sells = list(map(depthsMapSell, market['asks']))
      depths = {
        'bids': buys[:5],
        'asks': sells[:5]
      }
      myColWsDepths.update_one({'market': i}, {'$set': {'depths': depths}})

# WEBSOCKET

def SetCryWsToken():
    global  ws, sayac
    timeMiliSecond = int(round(time.time() * 1000))
    fullUrl = 'https://www.cryptopia.co.nz/signalr/negotiate?clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&_=' + str(timeMiliSecond)
    token = None
    r = requests.get(fullUrl)
    result = r.json()
    token = result['ConnectionToken']
    cryWsToken = urllib.parse.quote_plus(token)

    wsUrl = 'wss://www.cryptopia.co.nz/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionData=%5B%7B%22name%22%3A%22notificationhub%22%7D%5D&tid=7&connectionToken=' + cryWsToken
    
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
        startTime = time.time()  # TİMER BAŞLANGIÇ
        subSayac = 0
        uygunMarkets = PrepareDbAndGetUygunMarkets()
        lenth = len(uygunMarkets)
        while subSayac < lenth:
          besMarket = uygunMarkets[subSayac: subSayac+5]
          WsSubEkleBesMarkets(besMarket)
          #time.sleep(0.1)
          subSayac = subSayac + 5
          print(str(subSayac) + ' market eklendi. Tolam market: '+ str(lenth))
        print(str(sayac)+'. Orderbooks db insert işlemi bitti. Tarih: ', datetime.datetime.now())
        bitisTime = time.time() - startTime # TİMER BİTİŞ
        print(str(round(bitisTime,2)) + ' Saniye sürdü')
        set_interval(Basla, 1800)

    def WsSubEkleBesMarkets(besMarkets):
        DbOrderbookDoldurBesMarkets(besMarkets)
        for i in besMarkets:
          orderBookMessage = '{"H":"notificationhub","M":"SetTradePairSubscription","A":[' + str(i['TradePairId']) + ',null],"I":0}'
          ws.send(orderBookMessage)

    def on_close(ws):
        print("### closed ###")
    
    websocket.enableTrace(False)
    ws = websocket.WebSocketApp(wsUrl, on_message = on_message, on_error = on_error, on_close = on_close, on_open = on_open)
    ws.run_forever()
  
def Basla():
    global ws, sayac
    sayac = sayac + 1
    if ws:
        ws.close()
    print(str(sayac)+'. Defa Çalışıyor.')
    SetCryWsToken()

    
def set_interval(func, sec):
    def func_wrapper():
        set_interval(func, sec)
        func()
    t = threading.Timer(sec, func_wrapper)
    t.start()
    return t

Basla()
#set_interval(Basla, 1800) # yarım saat
#WebSocketleBaslat()
