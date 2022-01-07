+++
author = "Ock"
title = "Hot Observable, Cold Observable"
date = "2022-01-07"
description = "Observable에 대해 알아보자!"
categories = [
    "Swift"
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

Hot🔥 은 구독하는 순간부터 즉 이전 이벤트들은 무시하고 구도된 순간부터 다음 아이템들이 방출되고(ex: 라이브 방송)  
Cold❄️ 는 구독하는 순간 이전 이벤트들을 처음 부터 끝까지 전부 전달해 준다(ex: VOD).

다시말해 Hot은 구독 이후 발생한 아이템들에 대한 방출이 이루어 지고, Cold는 구독 시점 이전에 발생한 아이템들도 방출해준다고 되어있다.  
~~(잘못된 점 있으면 댓글 부탁드립니다)~~
