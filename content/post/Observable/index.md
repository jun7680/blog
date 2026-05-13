+++
author = "오깅중"
title = "RxSwift Hot Observable vs Cold Observable — 다중 구독에서 갈리는 동작"
date = "2022-01-07"
description = "Hot/Cold Observable의 차이는 구독 시점이 아니라 사이드 이펙트의 공유 여부. 실제 코드와 흔한 함정, 그리고 share/publish가 필요한 순간 정리."
categories = ["Swift"]
tags = ["RxSwift", "Observable"]
image = "Observable.png"
+++

RxSwift를 처음 만지면 그냥 `.subscribe { ... }` 붙이면 흐름이 흘러서 별 문제없이 동작한다. 그런데 같은 Observable에 두 곳에서 구독을 걸면 갑자기 네트워크 요청이 두 번 나간다거나, 타이머가 한 번만 도는 게 아니라 구독자마다 따로 도는 식의 상황이 생긴다. 이 차이가 바로 Hot이냐 Cold냐의 문제다.

## 정의

ReactiveX 공식 문서가 짧게 잘 정리해 둠.

> A "hot" Observable may begin emitting items as soon as it is created, and so any observer who later subscribes to that Observable may start observing the sequence somewhere in the middle. A "cold" Observable, on the other hand, waits until an observer subscribes to it before it begins to emit items.

요지는 이렇다.

- **Cold:** 구독자가 들어와야 비로소 아이템을 흘려보낸다. 구독자마다 시퀀스가 처음부터 다시 흐름. 라이브 방송이 아니라 VOD에 가까움.
- **Hot:** 구독 여부와 무관하게 흘러간다. 늦게 구독하면 그 시점 이후 아이템만 받음. 라이브 방송 쪽.

핵심은 "구독 시점"보다 **사이드 이펙트가 공유되느냐**다. Cold는 구독 = 새 사이드 이펙트 실행, Hot은 사이드 이펙트 하나를 여러 구독자가 공유.

## Cold 동작 확인

`Observable.create`로 만든 시퀀스는 기본 Cold다.

```swift
let cold = Observable<Int>.create { observer in
    print("create block 실행")
    observer.onNext(1)
    observer.onNext(2)
    observer.onCompleted()
    return Disposables.create()
}

cold.subscribe(onNext: { print("A:", $0) }).disposed(by: bag)
cold.subscribe(onNext: { print("B:", $0) }).disposed(by: bag)
```

출력:

```
create block 실행
A: 1
A: 2
create block 실행
B: 1
B: 2
```

`create block`이 **두 번 찍힘**. 구독자 두 명이 독립적인 시퀀스를 각각 받는다. 네트워크 호출이 `create` 안에 있었다면 API가 두 번 호출됐을 것.

## Hot 동작 확인

`PublishSubject`는 대표적인 Hot. 외부에서 `onNext`로 값을 밀어 넣고, 구독자들이 그걸 공유해서 받는다.

```swift
let hot = PublishSubject<Int>()

hot.subscribe(onNext: { print("A:", $0) }).disposed(by: bag)
hot.onNext(1)

hot.subscribe(onNext: { print("B:", $0) }).disposed(by: bag)
hot.onNext(2)
```

출력:

```
A: 1
A: 2
B: 2
```

A는 1을 봤지만 **B는 1을 못 봄**. 구독한 시점 이후의 이벤트만 받기 때문. 같은 `onNext(2)`는 두 명이 공유해서 받음 — 사이드 이펙트가 한 번만 일어나고 그 결과를 모두가 본다.

## 어떤 게 어디에 어울리나

| 케이스 | 어울리는 쪽 |
|--------|-------------|
| 네트워크 요청, DB 쿼리 | Cold — 구독자마다 새 요청을 보내는 게 자연스러움 |
| UI 이벤트(버튼 탭, 텍스트 입력) | Hot — 입력은 사용자 행위라 한 번 발생 |
| 알림(NotificationCenter, KVO) | Hot |
| 타이머가 "모두에게 같은 tick"이어야 할 때 | Hot |
| 타이머가 "구독자마다 독립적으로 흘러야 할 때" | Cold |

대부분의 함정은 Cold를 Hot처럼 다룰 때 생긴다. 같은 Cold Observable에 여러 구독을 걸어두고 "값 하나만 흐르겠지" 했는데 사이드 이펙트가 N번 일어나는 식.

## Cold → Hot 으로 바꾸는 법: share / publish

API 호출 같은 Cold 시퀀스를 여러 구독자가 공유해야 할 때 `share`를 쓴다.

```swift
let request = api.fetchUser()           // Cold
    .share(replay: 1, scope: .whileConnected)

request.subscribe(onNext: { ... }).disposed(by: bag)
request.subscribe(onNext: { ... }).disposed(by: bag)
// API 호출은 한 번만. 두 구독자가 같은 응답을 본다.
```

`share(replay:)`는 마지막 N개 이벤트를 늦게 들어온 구독자에게도 다시 흘려준다. 네트워크 응답을 두세 곳에서 동시에 사용해야 할 때 자주 쓰는 패턴.

조금 더 저수준으로 들어가면 `publish() + connect()` 조합이 있다. `publish`는 Cold를 `ConnectableObservable`로 바꾸고, `connect()`가 호출돼야 비로소 시퀀스가 흐른다. 구독 시점과 방출 시작 시점을 분리하고 싶을 때 쓴다. 대부분의 실무 케이스에서는 `share`로 충분.

## Subject 종류 짚고 가기

Hot은 보통 Subject를 통해 만든다. 셋이 미묘하게 달라서 한 번 정리.

- **`PublishSubject<T>`** — 구독 이후 값만 받음. 가장 기본.
- **`BehaviorSubject<T>`** — 마지막 값을 1개 보관. 구독하자마자 그 값을 받음. 초기값 필수. UI 상태에 잘 어울림.
- **`ReplaySubject<T>`** — 마지막 N개를 보관. 늦게 구독해도 N개를 다시 받음. 사용 시 메모리 주의.

`BehaviorRelay`(예전 `Variable`)는 BehaviorSubject 위에 에러·완료가 안 흐르도록 감싼 래퍼. UI 바인딩에 가장 흔히 씀.

## 정리

- 구독 시점보다 **사이드 이펙트의 공유 여부**로 Hot/Cold를 구분하면 헷갈리지 않음.
- 같은 Observable에 다중 구독을 건다면 "이게 Cold면 N번 실행된다"를 일단 의심.
- 네트워크 응답 공유는 `share(replay: 1)`로 단순화.
- UI 상태는 `BehaviorRelay`, 이벤트는 `PublishSubject`가 보통의 출발선.

이 구분 한 번 잡아두면 `merge`, `flatMap`, `combineLatest` 같은 합성 연산자 다룰 때도 "이 시점에 시퀀스가 다시 도는 건가, 공유되는 건가"가 자연스럽게 보인다.
