def is_leap(year):
    leap = False
    
    # Write your logic here
    if year % 4 == 0 and year % 100 == 0 and year % 400 ==0:
        leap= True
    else:
        leap = False
    
    return leap

print(is_leap(1992))