+++
author = "오깅중"
title = "SwiftUI 모달 세 개째부터는 Bool 말고 enum 라우팅으로"
slug = "swiftui-sheet-bool-to-identifiable-enum"
date = "2026-05-21T13:45:26+09:00"
description = "SwiftUI에서 modal 여러 개를 각각 @State Bool로 관리하다가 깨진 경험과 Identifiable enum 한 개로 묶어 푼 패턴을 정리한 글"
categories = ["SwiftUI"]
tags = ["SwiftUI", "sheet", "State", "Modal"]
+++

처음에 SwiftUI에서 `.sheet`를 띄울 일이 두 개 정도였을 때는 별생각 없이 `@State private var showProfile = false`, `@State private var showSettings = false` 식으로 Bool 두 개 잡아서 썼다. 동작도 잘 됐고 별 문제 없었다.

근데 세 번째 sheet가 추가되는 순간부터 갑자기 동작이 이상해지는 케이스가 생겼고 어느 sheet가 닫히고 다른 게 뜨는 흐름에서 race가 보이기 시작해서 결국 enum 하나로 갈아엎었다. 그 얘기다.

## 많이 실수하는 코드

홈 화면에 모달이 세 개 있다고 치자. 가장 손이 빠른 코드는 보통 이렇게 나온다.

```swift
struct HomeView: View {
    @State private var showProfile = false
    @State private var showSettings = false
    @State private var showAbout = false

    var body: some View {
        VStack {
            Button("프로필") { showProfile = true }
            Button("설정") { showSettings = true }
            Button("정보") { showAbout = true }
        }
        .sheet(isPresented: $showProfile) { ProfileView() }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showAbout) { AboutView() }
    }
}
```

겉으로는 깔끔하게 분리된 것처럼 보이는데 막상 돌려보면 sheet가 안 뜨거나, 닫고 다른 걸 띄우면 빈 화면이 한 번 깜빡이고 뜨는 식의 이상 동작이 종종 잡힌다.

## 왜 문제

크게 세 가지가 겹친다.

첫째로 SwiftUI에서 같은 view에 `.sheet` modifier를 여러 개 붙이면 보통 마지막 하나만 살아남고 나머지는 무시되는 경우가 있어서 위 코드는 그 자체가 SwiftUI가 보기엔 "이 view는 sheet가 하나"인 셈인데 우리는 세 개라고 생각하고 있는 거다.

둘째로 한 sheet가 닫히기 전에 다른 sheet를 띄우려고 dismiss 콜백 안에서 다른 Bool을 true로 만들면 SwiftUI가 첫 sheet의 dismiss 애니메이션과 두 번째 sheet의 present 애니메이션을 동시에 처리하다가 race가 나는데 이게 시뮬레이터에선 잘 되고 실기기에선 깨지는 식으로 재현이 까다롭다.

셋째로 Bool N개는 상태 공간이 2^N이라서 "showProfile == true && showSettings == true" 같은 의미상 불가능한 상태가 코드 차원에선 가능해진다. 우리는 머릿속에서 "동시엔 한 개만 뜨지" 라고 가정하지만 SwiftUI는 그런 가정을 모른다.

핵심은 이거다.

> modal 상태는 본질적으로 "지금 뜬 게 뭐냐"라는 하나의 값인데 그걸 N개 Bool로 흩뿌리면 그 사이가 다 의미 없는 상태 공간이 된다

## 해결 — Identifiable enum 한 개

값이 본질적으로 하나라면 그렇게 모델링하면 된다.

```swift
enum ActiveSheet: Identifiable {
    case profile
    case settings
    case about

    var id: Self { self }
}

struct HomeView: View {
    @State private var activeSheet: ActiveSheet?

    var body: some View {
        VStack {
            Button("프로필") { activeSheet = .profile }
            Button("설정") { activeSheet = .settings }
            Button("정보") { activeSheet = .about }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .profile: ProfileView()
            case .settings: SettingsView()
            case .about: AboutView()
            }
        }
    }
}
```

`activeSheet`는 한 번에 하나의 케이스만 가질 수 있는 enum이라 동시에 두 sheet가 뜨는 상태가 타입 차원에서 불가능해지고, `.sheet(item:)`은 nil → non-nil로 바뀌면 띄우고 non-nil → nil이면 닫는 식으로 동작해서 view에 modifier가 하나만 붙으면 된다.

대부분의 "모달 여러 개 띄우다가 꼬임" 케이스는 이걸로 풀린다.

## associated value를 쓰고 싶을 때

sheet마다 파라미터가 다르면 case에 associated value를 같이 달면 되는데 이때 `id` 설계가 약간 변수가 된다.

```swift
enum ActiveSheet: Identifiable {
    case profile(userId: String)
    case settings
    case about

    var id: String {
        switch self {
        case .profile(let userId): return "profile-\(userId)"
        case .settings: return "settings"
        case .about: return "about"
        }
    }
}
```

`Identifiable`은 `id`만 만족하면 되니까 case별로 id 규칙을 자유롭게 줄 수 있는데 한 가지 알아둘 점은 같은 case의 파라미터만 바꿨을 때(`profile("A")` → `profile("B")`) id가 달라지면 SwiftUI가 "다른 아이템이 들어왔다"고 보고 sheet를 한 번 닫았다가 다시 띄운다는 거다.

이걸 원하면 위 코드처럼 두면 되고, 같은 sheet 안에서 내용만 부드럽게 바꾸고 싶으면 id를 case 이름만으로 묶고 파라미터는 내부 state로 따로 빼면 된다.

## 회고

같은 패턴은 `.fullScreenCover(item:)`, `.alert(...)`, `.confirmationDialog(...)`에도 거의 그대로 먹어서 한 번 enum 라우팅으로 가는 게 익숙해지면 모달 계열 코드가 전반적으로 차분해진다.

지나고 보니 Bool 두 개 정도까지는 손이 빠른 만큼 그냥 써도 큰 문제는 없는데 세 개째가 들어오는 순간엔 거의 항상 enum으로 갈아엎는 게 답이었고 결국 "지금 띄울 게 뭐냐"라는 질문이 본질적으로 하나의 값이라는 사실을 코드에 반영해주는 일이었다.

iOS 16 이전엔 `.sheet(item:)`이 enum identity로 가끔 충돌을 일으키던 시절도 있었는데 17부터는 안정적이라 요즘은 부담 없이 이쪽으로 가도 된다. Bool로 흩뿌리지 말고 한 자리에 모아두자는 게 결론이다.
