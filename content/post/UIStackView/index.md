+++
author = "오깅중"
title = "UIStackView isHidden이 누적되는 동작과 안전한 토글 패턴"
date = "2022-04-13"
description = "UIStackView 안의 view에 isHidden을 애니메이션으로 토글할 때 누른 횟수만큼 다시 눌러야 보이는 현상의 원인과, 의도대로 동작시키는 안전한 패턴 정리."
categories = ["Swift"]
tags = ["UIStackView", "UIKit", "Animation"]
+++

UIKit으로 토글 가능한 패널을 만들 때 가장 흔히 쓰는 건 `UIStackView` 안의 view에 `isHidden`을 적용하는 방식이다. 그런데 이걸 애니메이션 블록 안에서 토글하다 보면, **버튼을 다섯 번 누르면 다섯 번 다시 눌러야 보이는** 이상한 현상에 부딪힌다. 코드는 분명 한 줄인데 동작은 그렇지 않다. 처음 봤을 때는 디버그로 한참을 헤맸다.

## 현상

```swift
@IBAction func toggle(_ sender: Any) {
    UIView.animate(withDuration: 0.25) {
        self.targetView.isHidden.toggle()
    }
}
```

겉보기엔 멀쩡한 코드. 그런데 토글 버튼을 빠르게 여러 번 누르면 화면이 점점 어색해지고, 어느 시점부터는 버튼을 눌러도 view가 안 보인다. show/hide가 1:1로 대응되지 않고 **카운터가 쌓이는** 느낌.

## 원인

`UIView.animate(...)` 블록 안에서 `isHidden`을 set 하면 UIKit이 이걸 "애니메이션 가능한 속성 변경"으로 큐에 넣는다. `isHidden`은 `Bool` 한 값이지만, 내부적으로는 이 변경이 hide/show 트랜잭션 형태로 누적된다. 같은 값으로 다시 set 해도 트랜잭션이 별도로 쌓여서, 결과적으로 호출 횟수만큼 큐가 채워지는 거다.

StackOverflow의 [예전 글](https://stackoverflow.com/questions/33240635/hidden-property-cannot-be-changed-within-an-animation-block)에 같은 현상이 정리돼 있는데, 핵심은 "**같은 값으로 isHidden을 반복해서 set 하지 마라**"는 것. 즉 `false → false` 같은 무의미한 set도 큐에는 의미 있는 이벤트로 들어간다.

`toggle()` 자체는 값을 뒤집기만 하니까 큐가 안 쌓일 것 같지만, **animate 블록과 빠른 사용자 입력이 겹치면** 동일 값 set이 일어나는 타이밍이 생긴다. 결과적으로 누적.

## 해결: "값이 바뀔 때만 set"

해법은 단순하다. **현재 값과 다를 때만** 변경하기. UIView 확장으로 한 번 만들어두면 어디서나 안전하게 쓸 수 있다.

```swift
extension UIView {
    func setHiddenSafely(_ hidden: Bool) {
        guard isHidden != hidden else { return }
        isHidden = hidden
    }
}
```

토글 시:

```swift
UIView.animate(withDuration: 0.25) {
    self.targetView.setHiddenSafely(!self.targetView.isHidden)
}
```

이렇게 하면 같은 값으로의 set이 차단돼서 큐 누적이 발생하지 않는다. 빠르게 연타해도 보이는 상태와 호출 횟수가 1:1로 대응됨.

조금 더 명시적으로 쓰고 싶다면 메서드를 두 개로 쪼개도 된다.

```swift
extension UIView {
    func showAnimated() {
        guard isHidden else { return }
        isHidden = false
    }

    func hideAnimated() {
        guard !isHidden else { return }
        isHidden = true
    }
}
```

호출 측에서 의도가 명확해진다는 장점. 다만 토글 동작 한 줄로 끝낼 수 없어서 상황에 따라 위 두 방식 중 선택.

## animate 블록 바깥에서 호출하면?

```swift
self.targetView.isHidden.toggle()
```

애니메이션 없이 그냥 토글하면 누적은 거의 안 보인다. 결국 누적은 **애니메이션 블록 안에서의 반복 set**과 결합될 때 도드라진다. 그래서 "isHidden 토글 + UIView.animate 조합"을 쓸 때만 위 가드를 신경 쓰면 된다.

## 같은 패턴이 적용되는 다른 곳

isHidden과 비슷하게 "같은 값으로 set 해도 트랜잭션이 쌓이는" 속성이 UIKit에는 종종 있다. 대표적으로 `alpha`나 `transform`을 애니메이션 블록 안에서 다룰 때. 굳이 안 바뀐 값을 다시 박아 넣는 코드를 짜지 않으면 되는데, ViewModel 바인딩으로 자동 set 되는 경우엔 모르고 지나가기 쉽다.

Rx나 Combine 바인딩에서 자주 만나는 케이스인데, `distinctUntilChanged`(Rx) 또는 `removeDuplicates()`(Combine) 하나만 끼워둬도 같은 효과를 낼 수 있다.

```swift
viewModel.isLoading
    .distinctUntilChanged()
    .bind(onNext: { [weak self] hidden in
        UIView.animate(withDuration: 0.25) {
            self?.spinner.isHidden = hidden
        }
    })
    .disposed(by: bag)
```

## 정리

- `UIStackView` 안의 view를 `isHidden`으로 토글하면서 애니메이션을 걸면 **같은 값으로의 반복 set이 큐에 쌓여** 호출 횟수만큼 hide/show가 누적된다.
- 해결은 단순: **값이 실제로 바뀔 때만 set**. `guard isHidden != newValue`.
- 바인딩 기반이라면 `distinctUntilChanged` / `removeDuplicates`로 사전에 걸러두는 게 더 안전.
- alpha, transform 같은 다른 애니메이션 속성도 같은 문제가 잠재돼 있으니 동일 패턴 적용 권장.

UIKit 시절의 가장 미묘한 함정 중 하나. 한 번 잡아두면 어디서나 똑같이 써먹을 수 있다.

## 참고

- [Hidden property cannot be changed within an animation block — StackOverflow](https://stackoverflow.com/questions/33240635/hidden-property-cannot-be-changed-within-an-animation-block)
- [stackview isHidden attribute not updating as expected — StackOverflow](https://stackoverflow.com/questions/43831695/stackview-ishidden-attribute-not-updating-as-expected)
