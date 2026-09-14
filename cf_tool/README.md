HQLHTVKRQ

- Start app: 
adb shell monkey -p com.tencent.stc.cfl 1

- Close app
adb shell am force-stop com.tencent.stc.cfl

- Clear data

adb shell
su
rm -rf /data/data/com.tencent.stc.cfl/*

Pesudo code:

while:
	start app
	sleep 20s
	// Step n
	for step 1 to step n:
		while :
			screen shot
				if screen == step n:
					do something
					break
			sleep 5s
	
	stop app
	reset data
	sleep 10s 

flow: 
step 1 -> Click guest
step 2 -> click confirm
step 3 -> click submit
step 4 -> click input username
step 5 -> click input username keyboard -> typing -> click confirm
step 6 -> click type guild
step 7 -> click continue
step 8 -> click setting
step 9 -> click exit game
step 10 -> click confirm
step 11 -> click key binding
step 12 -> click continue -> click continue 
step 13 -> click inventory
step 14 -> click continue
step 15 -> click equip -> click bag 3
step 16 -> click quit use 
step 17 -> click out
step 18 -> click rank
step 19 -> click continue -> click match
step 20 -> click later
step 21 -> click mode -> click continue
step 22 -> click continue -> click back -> click continue
step 23 -> click close
step 24 -> click event
step 25 -> click invite friends
step 26 -> click invite input
step 27 -> click input keyboard -> typing -> click oke
step 28 -> click confirm

