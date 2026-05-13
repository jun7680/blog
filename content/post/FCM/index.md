+++
author = "오깅중"
title = "iOS에 FCM 붙이기 — 인증 키부터 토큰 흐름, 그리고 자주 막히는 지점"
date = "2022-01-10"
description = "Firebase Cloud Messaging을 iOS 프로젝트에 도입할 때 인증 키 발급부터 토큰 수신, 페이로드 수신, 자주 막히는 함정까지 한 번에 정리."
categories = ["Swift"]
tags = ["FCM", "Firebase", "PushNotification"]
image = "FCM.png"
+++

iOS에 푸시를 붙일 때 가장 흔히 쓰는 게 Firebase Cloud Messaging(FCM)이다. Google이 APNs 위에 한 겹 추상화를 깔아둔 형태라, 서버에서 한 가지 페이로드 포맷으로 iOS/Android/웹에 보낼 수 있어서 편하다. 다만 처음 붙일 때 인증 키, capability, 토큰 흐름 같은 게 한 번에 묶여서 어디서 막히는지 헷갈리기 쉽다. 한 번 정리해 둔다.

## 1. 사전 준비

세 가지가 필요하다.

1. **Apple Developer 푸시 인증 키 (`.p8`)** — Apple Developer Portal → Keys → APNs 권한 켜고 생성.
2. **Xcode 프로젝트의 Push Notifications capability** — Signing & Capabilities에서 추가.
3. **Firebase 프로젝트** — [Firebase Console](https://console.firebase.google.com)에서 새 프로젝트 → iOS 앱 등록 → Bundle ID 입력 → `GoogleService-Info.plist` 다운.

> 인증서(`.p12`)도 여전히 쓸 수 있지만, Apple도 Firebase도 `.p8` Auth Key를 권장한다. 키 하나면 만료 없이 여러 앱에 재사용 가능해서 관리가 훨씬 편하다.

## 2. SDK 설치

Swift Package Manager 기준.

```
https://github.com/firebase/firebase-ios-sdk
```

필요한 product만 골라 넣으면 되는데, FCM에는 보통 두 개만 있으면 충분.

- `FirebaseMessaging`
- `FirebaseAnalytics` *(선택, FCM 일부 통계가 Analytics에 의존)*

## 3. 초기화

`GoogleService-Info.plist`를 프로젝트에 추가했으면, AppDelegate에서 한 줄.

```swift
import UIKit
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        FirebaseApp.configure()

        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self

        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, _ in
            print("notification authorization:", granted)
        }
        application.registerForRemoteNotifications()
        return true
    }
}
```

SwiftUI 라이프사이클(`@main struct App`)을 쓰는 프로젝트라면 `UIApplicationDelegateAdaptor`로 AppDelegate를 끼워 넣으면 같은 코드가 동작한다.

```swift
@main
struct MyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    var body: some Scene { WindowGroup { RootView() } }
}
```

## 4. APNs 토큰 ↔ FCM 토큰 연결

FCM은 내부적으로 APNs 토큰을 받아서 자기 FCM 토큰으로 매핑한다. iOS는 두 곳에서 토큰을 받는다.

```swift
extension AppDelegate {
    // APNs가 발급한 디바이스 토큰
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("APNs 등록 실패:", error)
    }
}

extension AppDelegate: MessagingDelegate {
    // FCM이 발급/갱신한 토큰
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        // 서버에 등록
        AlarmAPI.shared.register(token: fcmToken)
    }
}
```

FCM 토큰은 **앱 첫 실행 / 재설치 / 데이터 초기화 / 토큰 갱신** 시에 바뀐다. delegate가 호출될 때마다 서버에 보내는 게 가장 안전.

또는 명시적으로 가져오는 방법도 있다.

```swift
Messaging.messaging().token { token, error in
    if let error { print("token error:", error); return }
    print("FCM token:", token ?? "")
}
```

## 5. Firebase Console에서 APNs 인증 키 업로드

이걸 안 하면 토큰은 받아져도 실제 푸시가 안 온다. 가장 흔히 막히는 지점.

Firebase Console → 프로젝트 설정 → **Cloud Messaging** 탭 → "Apple 앱 구성" 섹션 → APNs **인증 키** 업로드.

업로드 시 필요한 항목:

- `.p8` 키 파일
- Key ID (Apple Developer Portal에서 확인)
- Team ID

## 6. 페이로드 수신

포그라운드와 백그라운드 처리가 분리돼 있다.

```swift
extension AppDelegate: UNUserNotificationCenterDelegate {
    // 포그라운드 — 시스템 배너를 띄울지 결정
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        print("foreground payload:", userInfo)
        completionHandler([.banner, .sound, .badge])
    }

    // 배너 탭 후 진입
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        // 딥링크 라우팅 등
        completionHandler()
    }
}
```

`userInfo`에는 서버가 보낸 커스텀 키가 들어 있다. 딥링크 URL이나 라우팅 식별자를 여기에 실어 두고, 탭 시 화면 이동에 활용.

## 7. 자주 막히는 지점

푸시 붙이면서 가장 자주 만나는 함정들.

- **시뮬레이터로 푸시 테스트 → 안 온다.** 옛 시뮬에선 아예 불가능했고, 지금은 가능하긴 한데 동작이 미묘하다. 실제 기기로 테스트하는 게 가장 빠르다.
- **`Messaging.messaging().delegate = self`를 안 함.** `didReceiveRegistrationToken`이 영원히 안 불려서 "토큰이 왜 안 오지?" 하고 헤맴.
- **Push Notifications capability를 안 켬.** 콘솔에서 인증 키까지 다 잘 박았는데 푸시가 안 오는 1순위 이유.
- **Background Modes의 "Remote notifications"** — silent push(`content-available: 1`) 받을 거라면 켜야 함. 일반 알림만 받을 거면 필수는 아님.
- **Provisioning Profile에 push entitlement 누락.** 자동 서명 쓰면 보통 알아서 들어가는데, 수동 서명 환경에선 capability 추가 후 프로파일 재생성 필요.
- **APNs 환경 불일치** — Development 인증 키로 빌드해놓고 TestFlight에서 안 오는 경우. `aps-environment`가 `development`인지 `production`인지 확인.

## 8. 페이로드 예시

서버에서 FCM HTTP v1 API로 쏘는 페이로드 예.

```json
{
  "message": {
    "token": "DEVICE_FCM_TOKEN",
    "notification": {
      "title": "주문이 접수됐어요",
      "body": "조금만 기다려 주세요"
    },
    "data": {
      "deeplink": "myapp://orders/12345"
    },
    "apns": {
      "payload": {
        "aps": {
          "sound": "default",
          "badge": 3
        }
      }
    }
  }
}
```

`notification`은 OS가 알아서 배너로 띄우는 표준 영역, `data`는 앱이 해석하는 커스텀 영역. 둘 다 보낼 수 있고, 보통은 둘 다 채워서 보낸다.

## 정리

- 인증 키(`.p8`) → SDK 설치 → AppDelegate 초기화 → APNs 토큰을 FCM에 전달 → Firebase Console에 인증 키 업로드 → 페이로드 수신 핸들러. 이 흐름만 한 번 깔끔하게 잡으면 끝.
- 거의 모든 푸시 안 됨 원인은 capability 누락, delegate 미설정, Console 인증 키 누락 셋 중 하나.
- 진짜로 동작하는지 확인할 땐 **반드시 실제 기기**로.

자세한 공식 가이드는 [Firebase 문서](https://firebase.google.com/docs/cloud-messaging/ios/client)에 잘 정리돼 있다. 한 번 붙여 두면 그 뒤로는 토큰 갱신/페이로드 처리 정도만 계속 손보면 된다.
