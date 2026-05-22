+++
author = "오깅중"
title = "실기기에서만 깨진 콜드스타트 푸시 race condition 디버깅 기록"
slug = "ios-cold-start-push-race-debugging"
date = "2026-05-22T09:30:00+09:00"
description = "시뮬레이터에서는 멀쩡했지만 실기기 콜드스타트 푸시에서만 상세 화면이 열리지 않던 문제를 네 단계로 추적한 기록."
categories = ["Swift"]
tags = ["iOS", "Swift", "PushNotification", "Coordinator", "RaceCondition", "SwiftData", "Debugging"]
+++

푸시 알림을 탭해서 앱을 콜드스타트로 열었더니 리스트는 빈 화면이고, 상세는 끝까지 안 떴다.

조금 기다리면 리스트 데이터는 뒤늦게 채워졌다. 그런데 푸시가 가리키던 상세 화면은 다시 살아나지 않았다. 더 얄미운 건 시뮬레이터에서는 멀쩡했다는 점이다. 실기기 + 콜드스타트 + 특정 상세 진입. 이 세 조건이 겹칠 때만 깨졌다.

전형적인 race condition이었다. 한 번 고치면 끝날 줄 알았는데, 실제로는 네 번 잡았다. 네 번 다 "이제 됐겠지?" 했고, 네 번 다 틀렸다. 하하.

## 첫 번째 원인: 시작 직후 로컬 저장소를 너무 믿음

푸시 진입 코드를 보니 상세 화면을 만들기 전에 로컬 저장소에서 컨테이너 정보를 먼저 읽고 있었다.

```swift
let containerRemoteID = loadContainerFromType(.all)?.remoteID
    ?? ContainerType.all.reservedId

let item = try await loadSpecificItem(
    remoteContainerID: containerRemoteID,
    remoteItemID: itemID
)
```

문제는 콜드스타트였다. 앱이 막 켜진 순간에는 SwiftData 부트스트랩이 아직 끝나지 않을 수 있다. 그러면 로컬 row가 없고, 코드는 `reservedId`로 떨어진다. 그 값으로 서버에 단건 조회를 던지니 대상 데이터를 못 찾는다.

다른 도메인은 멀쩡했다. 이유는 단순했다. 거기는 `itemID`만 가지고 바로 Coordinator를 만들고, 상세 ViewModel이 내부에서 필요한 데이터를 가져왔다. 특정 상세만 진입 단계에서 fetch 책임까지 들고 있었다.

그래서 패턴을 맞췄다. 푸시 진입 단계는 id 검증과 화면 생성까지만 한다. 단건 fetch는 상세 ViewModel이 자기 책임으로 처리한다.

```swift
guard itemID.isValid else { return nil }

return await makeItemDetail(
    itemID: itemID,
    pushKind: pushKind,
    navigationController: navigationController
)
```

이렇게 바꾸니 첫 번째 문제는 사라졌다. 하지만 진짜 시작은 여기부터였다.

## 두 번째 원인: 아래 레이어에도 같은 의존성이 남아 있음

fetch 책임을 ViewModel로 옮겼는데도 특정 케이스가 계속 실패했다.

Operator 안쪽을 보니 다시 컨테이너의 remote id를 보고 있었다.

```swift
let queryID = container.type.remoteQueryID(remoteID: container.remoteID)
let result = try await specificItem(queryID: queryID, itemID: itemID)
```

레이어만 옮겼을 뿐, "로컬 컨테이너 정보가 이미 준비되어 있다"는 가정은 그대로 남아 있었다. 콜드스타트에서는 transient container가 fallback 값을 들고 있고, 그 값으로 queryID를 만들면 서버가 기대하는 값과 달라진다.

처음에는 enum의 기본 queryID를 쓰면 되겠다고 생각했다. 그런데 일부 상세 타입에서 또 깨졌다. 기존 로직이 특정 remote id 매핑에 우연히 기대고 있었기 때문이다.

최종적으로는 호출 측에서 푸시 payload의 정적 식별자를 그대로 내려보냈다. 푸시 payload는 이미 서버가 이해하는 route 식별자를 갖고 있었다. 클라이언트가 시작 직후 로컬 저장소를 다시 뒤져서 재구성할 이유가 없었다.

```swift
let pushQueryID = switch pushKind {
case .reviewRequest:
    "review-request"
case .reviewWaiting:
    "review-waiting"
case .unknown:
    "all"
}

try await loadSpecificItem(
    itemID: itemID,
    pushOverrideQueryID: pushQueryID
)
```

Operator는 override가 있으면 그대로 사용하게 했다.

```swift
let queryID: String

if let pushOverrideQueryID {
    queryID = pushOverrideQueryID
} else {
    queryID = container.type.remoteQueryID(remoteID: container.remoteID)
}
```

여기까지 하고 나니 일반 상세와 특수 상세가 같이 통과했다.

## 세 번째 원인: 특수 상세는 다른 경로를 타고 있음

빌드해서 다시 찍어보니 특수 상세에서는 방금 고친 Operator의 breakpoint가 안 잡혔다. 다른 경로였다.

상세 ViewModel 안에 타입별 분기가 있었다.

```swift
switch detailKind {
case .reviewWaiting, .reviewRequest:
    loadReviewItem()
case .receipt:
    loadReceiptItem()
default:
    fetchItemForPush()
}
```

특수 상세는 별도 API를 타고 있었다. 더 문제는 그 API의 베이스 로직이었다. 시작하자마자 로컬 본문 entity가 있는지 먼저 확인했다.

```swift
guard let cachedBody = BodyDAO.read(itemID: itemID) else {
    return .failure(.dataNotFound)
}
```

콜드스타트 푸시에서는 아직 로컬 본문이 없을 수 있다. 그러면 네트워크 요청까지 가기도 전에 실패한다. 화면에는 "데이터를 찾을 수 없습니다" 류의 alert만 남는다.

이 분기에도 푸시 콜드스타트 가드를 추가했다.

```swift
case .reviewWaiting, .reviewRequest:
    if rowID == nil, let pushKind {
        fetchItemForPush(pushKind: pushKind)
        return
    }

    loadReviewItem()
```

이미 `fetchItemForPush`가 응답 타입별 분기를 갖고 있어서, 별도 fetch 함수를 더 늘리지 않아도 됐다. 이런 순간은 좋다. 새 추상화 안 만든 날은 마음이 편하다.

## 네 번째 원인: 화면은 떴는데 액션 후 닫히지 않음

이제 상세 화면까지는 도달했다. 그런데 상세 안에서 액션을 마치고 돌아가야 하는 순간, 화면이 그대로 남았다.

콜백은 이런 구조였다.

```swift
func detachAction() {
    controllable?.shutdownAction {
        self?.detailDelegate?.detachDetail()
    }
}
```

셀 탭으로 들어온 사용자는 정상 동작했다. 리스트 Coordinator가 부모로 있고, 그 부모가 `detailDelegate`로 들어가기 때문이다.

푸시 진입은 다르다. 라우터가 상세 Coordinator를 직접 만들고 navigation stack에 push한다. 부모 Coordinator가 없다. 그러니 delegate도 nil이다.

Coordinator의 `shutdown()`도 비슷했다.

```swift
func shutdown() {
    sceneFinishDelegate?.finish(to: self)
}
```

`sceneFinishDelegate`가 없으면 아무 일도 안 한다. optional chaining이 조용히 실패를 숨기고 있었다.

fallback을 추가했다.

```swift
func shutdown() {
    if let sceneFinishDelegate {
        sceneFinishDelegate.finish(to: self)
    } else {
        navigationController.popViewController(animated: true)
    }
}
```

액션 콜백도 delegate가 없으면 coordinator의 `shutdown()`으로 빠지게 했다.

```swift
func detachAction() {
    controllable?.shutdownAction { [weak self] in
        if let delegate = self?.detailDelegate {
            delegate.detachDetail()
        } else {
            self?.controllable?.shutdown()
        }
    }
}
```

이제 푸시로 들어온 상세도 액션을 마친 뒤 정상적으로 navigation stack에서 빠졌다.

## 이번에 다시 배운 것

시뮬레이터와 실기기의 차이는 race condition을 꽤 잘 숨긴다. 디스크 I/O, CPU 여유, 로컬 저장소 부트스트랩 타이밍이 다르다. 시뮬레이터에서는 race window가 닫혀 있어서 한 번도 안 보이던 버그가 실기기에서는 매번 보일 수 있다.

또 하나. 한 레이어만 self-contained하게 고쳐서는 부족했다. 이번 호출 체인에는 같은 가정이 네 군데에 있었다.

- 진입 단계가 로컬 컨테이너 DB를 먼저 읽음
- Operator가 컨테이너 remote id로 queryID를 다시 만듦
- 특수 상세 경로가 로컬 본문 entity를 먼저 요구함
- Coordinator가 부모 delegate 존재를 전제함

각각은 작은 코드였다. 그런데 콜드스타트 푸시처럼 시간에 민감한 경로에서는 작은 가정들이 전부 race 지점이 된다.

다음부터는 이런 증상을 만나면 한 함수만 보지 말고, 푸시 payload가 들어온 순간부터 화면이 닫히는 순간까지 호출 체인을 한 번에 훑어야겠다. "이번엔 진짜 마지막 수정"이라는 말은 당분간 금지다.

## 점검 체크리스트

- 콜드스타트 + 푸시 + 실기기 조합이 QA 시나리오에 들어가 있는가
- 푸시 payload가 서버 식별자를 이미 담고 있다면, 시작 직후 클라이언트가 다시 로컬 DB에서 재구성하지 않는가
- 같은 종류의 상세 진입이 한 가지 패턴으로 통일되어 있는가
- 외부 진입으로 열린 Coordinator가 부모 없이도 자기 화면을 닫을 수 있는가
- delegate nil이 "아무 일도 안 함"으로 끝나지 않고 의도된 fallback을 타는가

