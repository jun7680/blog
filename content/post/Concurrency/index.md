+++
author = "오깅중"
title = "GCD에서 Swift Concurrency로 — 콜백 지옥을 async/await로 정리하기"
date = "2022-01-11"
description = "GCD의 DispatchQueue·QoS 기본기와, 같은 코드를 async/await로 옮길 때 무엇이 달라지는지. 콜백 지옥, 에러 핸들링 분리, 데드락 함정까지."
categories = ["Swift"]
tags = ["Concurrency", "GCD", "asyncawait"]
+++

iOS 개발에서 비동기 처리는 오랫동안 GCD(Grand Central Dispatch)가 도맡았다. 2021년 Swift Concurrency가 나오면서 async/await로 옮겨가는 분위기인데, 둘이 어떻게 다른지 그리고 GCD 코드를 들어내면서 만나는 함정을 한 번 정리해뒀다.

## GCD 기본기 짚고 가기

GCD는 Objective-C 시절부터 있던 저수준 동시성 API다. 작업을 큐에 넣으면 시스템 스레드풀이 알아서 굴려준다. 핵심은 큐 종류와 QoS.

### DispatchQueue 종류

```swift
// 메인 큐 — UI 작업 전용
DispatchQueue.main.async { /* UI 업데이트 */ }

// 글로벌 큐 — 시스템이 관리하는 백그라운드 큐
DispatchQueue.global(qos: .userInitiated).async { /* heavy 작업 */ }

// 커스텀 직렬 큐
let serial = DispatchQueue(label: "com.app.serial")
serial.async { /* 순차 실행 */ }

// 커스텀 동시 큐
let concurrent = DispatchQueue(label: "com.app.concurrent", attributes: .concurrent)
```

직렬(serial)이든 동시(concurrent)든 **작업 시작 순서는 FIFO**다. 끝나는 순서까지 FIFO인 건 직렬 큐만 보장.

### QoS — 우선순위 힌트

```swift
.userInteractive   // 화면 갱신, 애니메이션
.userInitiated     // 사용자가 즉시 결과를 기다리는 작업
.default
.utility           // 진행 표시가 있는 장기 작업
.background        // 백업, 인덱싱 등 보이지 않는 작업
```

QoS는 어디까지나 힌트다. 시스템이 상황 봐서 조정함. 그래도 명시해 두면 우선순위 역전(priority inversion) 같은 미묘한 문제를 줄여준다.

## GCD의 골치 — 콜백 지옥과 에러 핸들링

GCD로 짠 비동기 흐름은 결국 클로저 중첩으로 표현된다.

```swift
func loadProfile(completion: @escaping (Result<Profile, Error>) -> Void) {
    api.fetchUser { userResult in
        switch userResult {
        case .success(let user):
            api.fetchOrders(for: user.id) { orderResult in
                switch orderResult {
                case .success(let orders):
                    cache.save(orders) { saveResult in
                        switch saveResult {
                        case .success:
                            completion(.success(Profile(user: user, orders: orders)))
                        case .failure(let error):
                            completion(.failure(error))
                        }
                    }
                case .failure(let error):
                    completion(.failure(error))
                }
            }
        case .failure(let error):
            completion(.failure(error))
        }
    }
}
```

세 단계만 들어가도 가독성이 폭락한다. 더 문제는 에러를 매 단계마다 손으로 흘려보내야 한다는 것. 한 곳이라도 빠뜨리면 `completion`이 안 불려서 호출자가 영원히 기다리게 된다.

## Swift Concurrency — 같은 흐름을 async/await로

WWDC 2021에서 도입된 async/await는 위 흐름을 거의 동기 코드처럼 풀어낸다.

```swift
func loadProfile() async throws -> Profile {
    let user   = try await api.fetchUser()
    let orders = try await api.fetchOrders(for: user.id)
    try await cache.save(orders)
    return Profile(user: user, orders: orders)
}
```

가독성도 좋고, 에러는 `throws` 한 줄로 위임된다. **데이터는 return, 에러는 throw**로 채널이 분리되니까 콜백 시절의 `(Result?, Error?)` 둘 다 nil인 모호한 케이스가 사라진다.

## 병렬로 굴리고 싶을 때 — async let

순차로 await 하면 1번 끝나야 2번이 시작되는 게 단점일 수 있다. 의존이 없는 작업은 `async let`으로 병렬로 던지자.

```swift
func loadDashboard() async throws -> Dashboard {
    async let user    = api.fetchUser()
    async let banners = api.fetchBanners()
    async let feed    = api.fetchFeed()

    return try await Dashboard(
        user: user,
        banners: banners,
        feed: feed
    )
}
```

세 요청이 동시에 떠나고, `await`에 도달했을 때 비로소 결과를 기다린다. 같은 걸 GCD로 풀려면 `DispatchGroup` + `notify` + 콜백을 직접 엮어야 한다.

## Task — 동기 컨텍스트에서 async 함수 호출하기

UI 액션처럼 비동기가 아닌 곳에서 async 함수를 띄울 때는 `Task`를 쓴다.

```swift
@IBAction func reloadTapped() {
    Task {
        do {
            let profile = try await loadProfile()
            apply(profile)
        } catch {
            present(error)
        }
    }
}
```

`Task`는 자기만의 컨텍스트로 떠나고, UI 갱신은 `@MainActor`가 알아서 메인으로 호핑시켜준다. 옛 코드에서 `DispatchQueue.main.async {}` 감싸던 패턴이 거의 사라짐.

## GCD에서 async/await로 옮길 때 만난 함정

### 1. 메인 스레드 데드락

GCD 시절 가장 잘 죽는 패턴.

```swift
// 메인 스레드에서 이 코드를 실행하면 데드락
DispatchQueue.main.sync { /* ... */ }
```

`sync`로 자신이 갇혀 있는 큐에 다시 들어가려고 해서 생기는 데드락. async/await에서도 비슷한 변형이 있는데, 메인 액터 컨텍스트에서 `await MainActor.run { ... }`을 무의식적으로 부르면 의외의 호핑이 일어난다. 대부분의 경우 그냥 메서드에 `@MainActor`를 붙이거나 호출 측 컨텍스트만 잘 잡으면 해결.

### 2. 캡처와 self의 강한 참조

GCD `DispatchQueue.global().async { self.foo() }` 패턴은 `[weak self]`를 의식적으로 붙여줘야 했다. `Task` 클로저도 동일. 다만 `Task`는 cancellation을 명시적으로 다룰 수 있으니까, 라이프사이클이 끝나면 `task?.cancel()`을 호출해 두면 깔끔하다.

```swift
final class FeedVM {
    private var task: Task<Void, Never>?

    func load() {
        task = Task { [weak self] in
            guard let self else { return }
            try? await self.refresh()
        }
    }

    deinit { task?.cancel() }
}
```

### 3. 콜백 API를 async로 감싸기

전부 새로 짤 수는 없으니 GCD 콜백을 `withCheckedContinuation`으로 감싸서 점진적으로 옮긴다.

```swift
func legacyFetch() async throws -> Data {
    try await withCheckedThrowingContinuation { cont in
        oldAPI.fetch { result, error in
            if let error { cont.resume(throwing: error); return }
            cont.resume(returning: result!)
        }
    }
}
```

continuation은 **정확히 한 번** 호출돼야 한다. 두 번 호출하면 런타임 크래시, 한 번도 안 부르면 영원히 await가 멈춤. 옛 콜백 API가 둘 다 nil이나 둘 다 값이 있는 케이스를 만들 수 있으면 가드를 잘 두자.

## 정리

- GCD는 여전히 유효하지만, 새 코드는 async/await가 출발선이다.
- 콜백 → async/await로 옮기면 **에러 채널이 throws로 단일화**되고 가독성이 폭증한다.
- 독립 작업은 `async let`으로 병렬, UI 호출은 `Task`로 진입, 옛 콜백은 `withCheckedContinuation`으로 다리 놓기.
- 데드락, self 캡처, continuation 호출 횟수 — 옛 함정들이 모양만 바뀌어 따라오니까 옮길 때 잠깐 멈춰서 점검.

콜백 지옥을 한 번 들어내고 나면 다시 돌아가기 싫어진다. 옛 코드도 기능 손볼 때마다 조금씩 async/await로 옮겨두면 어느 순간 콜백이 거의 안 남아 있게 된다.
