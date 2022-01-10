+++
author = "Ock"
title = "iOS에서 FCM 사용하기!"
date = "2022-01-10"
description = "FCM을 적용해보자!"
categories = [    
    "FCM"
]
tags = [
    "FCM"
]
image = "FCM.png"
+++
## FCM
- Firebase Cloud Messaging으로 구글에서 무료로 메시지를 안정적으로 전송할 수 있는 교차 플랫폼 메시징 솔루션!
### FCM 설정
준비 사항
- Apple 개발자 계정의 푸시 알림 인증 키를 가져온다.
- XCode의 APP > Capabilities에서 푸시 알림 사용 설정을 한다.
- [Firebase Console](https://console.firebase.google.com/u/0/)에서 프로젝트를 추가한다.

#### Firebase 앱 등록
- 프로젝트를 추가하고 나오면 중앙에 ![](FCM_iOS+.png)
 iOS+를 눌러 App Bundle ID를 넣고 다음을 누르면 **GoogleService-Info.plist**를 다운받을수 있다.
 
- Xcode 프로젝트로 돌아가 SPM에 ``https://github.com/firebase/firebase-ios-sdk``를 추가 해준다.  
(최신 버전을 사용해 주는 것이 좋지만 필요하다면 이전 버전을 사용해도 무방하다)

- 추가를 해주고 프로젝트에서 초기화 코드를 추가 해 주면 된다.

#### Firebase 초기화 코드
1. AppDelegate.swift에 가서 Firebase를 import 해준다.
```Swift
import Firebase
```
2. didFinishLaunchingWithOptions 메서드에서 FirebaseApp.configure()를 날려준다
```swift
func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    ...
    FirebaseApp.configure()
    ...
}
```
3. 이제 시작될때 원격 알림에 앱을 등록을 해줘야 하는데 친절하게 이미 구현이 되어있다.
```swift
func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    ...
    FirebaseApp.configure()
    application.registerForRemoteNotifications()
    ...
}
```
다 된거 같지만 중요한 토큰 등록이 남아있다.

#### Firebase 토큰 등록

토큰은 messaging:didReceiveRegistrationToken 메서드를 통해 전달 되는데 해당 메서드는 MessagingDelegate에 구현 되어있는 함수를 이용하거나 token(completion)을 사용하여 직접 토큰을 가져올 수 있다.

```swift 
------Delegate 이용
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        fcmToken <- 이게 넘어오는 토큰이다. 
    }
}
func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    ...
    FirebaseApp.configure()
    application.registerForRemoteNotifications()
    Messaging.messaging().delegate = self // <- 이거 안해줘서 한참을 얼탔던 기억이..
    ...
}
 

------token(completion:) 이용
Messaging.messaging().token { token, error in 

// 실행 코드
}

```
알림 서버가 구축되어있으면 자신이 사용하는 서버에 fcm 토큰 값을 보내서 사용하면 된다!!

구글의 정석적인 설명을 보고 싶으면 [여기](https://firebase.google.com/docs/cloud-messaging/ios/client)로 가서 보면 구글의 친절한 설명을 볼 수 있다.!

## ~~알림 테스트를 할 경우 꼭 실제 기기에서 해보세요!! 시뮬에서 백번 돌려도 백번 다 안나왔던 기억이 있습니다.~~
