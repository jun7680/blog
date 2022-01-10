+++
author = "Ock"
title = "Hot Observable, Cold Observable"
date = "2022-01-07"
description = "Observable에 대해 알아보자!"
categories = [    
    "Observable"
]
tags = [
    "RxSwift"
]
image = "Observable.png"
+++
**습관처럼 사용하는 Observable에 대해서 제대로 알고 쓰고자 다시 정리를 해보았다!**
#### 개념

먼저 공식문서에 따르면 (https://reactivex.io/documentation/observable.html)
>> “Hot” and “Cold” Observables
When does an Observable begin emitting its sequence of items? It depends on the Observable. A “hot” Observable may begin emitting items as soon as it is created, and so any observer who later subscribes to that Observable may start observing the sequence somewhere in the middle. A “cold” Observable, on the other hand, waits until an observer subscribes to it before it begins to emit items, and so such an observer is guaranteed to see the whole sequence from the beginning.
In some implementations of ReactiveX, there is also something called a “Connectable” Observable. Such an Observable does not begin emitting items until its Connect method is called, whether or not any observers have subscribed to it.


라고 설명 되어있는데 ~~(영어라 모르겠다..)~~

아는 단어 총 동원해서 보면 hot, cold의 차이점은 구독 시점에 따른 아이템 방출 방법 이라고 되어 있다.

Hot🔥 은 생성됨과 동시에 아이템을 방출하고 나중에 구독한 옵저버는 이전값을 받을수 없고(ex: 라이브 방송)  
Cold❄️ 는 옵저버가 구독하기 전에 발생한 아이템에 대해 받아볼 수 있다.(ex: VOD).

다시말해 Hot은 구독 이후 발생한 아이템들에 대한 방출이 이루어 지고, Cold는 구독 시점 이전에 발생한 아이템들도 방출해준다고 되어있다.  
~~(잘못된 점 있으면 댓글 부탁드립니다)~~

#### Hot Observable
- Timer, Subject, UIEvent 등등

#### Cold Observable
- Single, junt, of 등등 컴포넌트


~~Operator들에 대해 더 자세히 알아봐야겠다.~~
