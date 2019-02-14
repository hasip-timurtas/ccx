import websocket
import json
import _thread
import bitmex
from time import sleep

client = bitmex.bitmex(test=False, api_key="IJx_wvuEYxsrQNFsJQ6yEMXF", api_secret="TO5Sm0rmN0IHRpg_uXjRhVg54NlTWLiTIPvSQqYmP4RvfwZ9")
AMOUNT = 10
firstBuy = 0
oncekiBuy = 0

firstSell = 0
oncekiSell = 0

def hemenOrderKur():
    global oncekiBuy, oncekiSell, AMOUNT, client, firstBuy, firstSell
    if oncekiSell == 0:
        oncekiSell = firstSell
    elif firstSell < oncekiSell:
        print('Sell Fiat Düştü')
        tempOnceki = oncekiSell
        oncekiSell = firstSell
        # Oncekileri boz
        #client.Order.Order_cancelAll().result()
        #SELL KUR
        order = client.Order.Order_new(symbol='XBTUSD', side="Sell", orderQty=AMOUNT, price=firstSell).result()
        sonraOrderBoz(order[0]['orderID'])
        print("Sell kuruldu. Önceki price: "+ str(tempOnceki)+", şimdiki price: "+ str(firstSell))
            
    else:
        oncekiSell = firstSell
          
    if oncekiBuy == 0:
        oncekiBuy = firstBuy
    elif firstBuy > oncekiBuy:
        print('BUY Fiat ÇIKTI')
        tempOnceki = oncekiBuy
        oncekiBuy = firstBuy
        #Oncekileri boz
        #client.Order.Order_cancelAll().result()
        #SELL KUR
        order = client.Order.Order_new(symbol='XBTUSD', side="Buy", orderQty=AMOUNT, price=firstBuy).result()
        sonraOrderBoz(order[0]['orderID'])
        print("Buy kuruldu. Önceki price: "+str(tempOnceki)+", şimdiki price: "+ str(firstBuy))
    else:
        oncekiBuy = firstBuy
    

def sonraOrderBoz(orderId):
    global client
    sleep(300)
    client.Order.Order_cancel(orderID=str(orderId)).result()


def on_message(ws, message):
    global firstSell, firstBuy

    message = json.loads(message)
    action = message['action'] if 'action' in message else None

    try:
        if 'subscribe' in message:
            print("Subscribed to %s." % message['subscribe'])
        elif action:
            if action == 'update':
                firstSell = message['data'][0]["asks"][0][0]
                firstBuy = message['data'][0]["bids"][0][0]
                hemenOrderKur()   
    except Exception as e: print(e)
    
 
def on_error(ws, error):
    print(error)
 
def on_close(ws):
    print("### closed ###")
 
def on_open(ws):
    def run(*args):
        ws.send(json.dumps({"op": "subscribe", "args": ["orderBook10:XBTUSD"]}))
 
    _thread.start_new_thread(run, ())
 
 
if __name__ == "__main__":
    websocket.enableTrace(True)
    ws = websocket.WebSocketApp("wss://www.bitmex.com/realtime",
                              on_message = on_message,
                              on_error = on_error,
                              on_close = on_close)
    ws.on_open = on_open
    ws.run_forever()