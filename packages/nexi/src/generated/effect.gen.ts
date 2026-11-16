// @effect-diagnostics schemaNumber:off unnecessaryTypeofType:off
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
// non-recursive definitions
export type OrderStatusOrder = { readonly "orderId": string, readonly "amount": string, readonly "currency": string }
export const OrderStatusOrder = Schema.Struct({ "orderId": Schema.String, "amount": Schema.String.check(Schema.isPattern(new globalThis.RegExp("^[0-9]+$", "u")).annotate({ "expected": "a string matching the RegExp ^[0-9]+$" })), "currency": Schema.String.check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" })) }).annotate({ "identifier": "OrderStatusOrder" })
export type ErrorResponse = { readonly "errors"?: ReadonlyArray<{ readonly "code"?: string, readonly "description"?: string }>, readonly "error"?: string, readonly "message"?: string, readonly "status"?: number }
export const ErrorResponse = Schema.Struct({ "errors": Schema.optionalKey(Schema.Array(Schema.Struct({ "code": Schema.optionalKey(Schema.String), "description": Schema.optionalKey(Schema.String) }))), "error": Schema.optionalKey(Schema.String), "message": Schema.optionalKey(Schema.String), "status": Schema.optionalKey(Schema.Int) }).annotate({ "identifier": "ErrorResponse" })
export type CustomerInfo = { readonly "cardHolderName": string, readonly "cardHolderEmail"?: string, readonly "mobilePhoneCountryCode"?: string, readonly "mobilePhone"?: string }
export const CustomerInfo = Schema.Struct({ "cardHolderName": Schema.String.check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })), "cardHolderEmail": Schema.optionalKey(Schema.String.annotate({ "format": "email" })), "mobilePhoneCountryCode": Schema.optionalKey(Schema.String.check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" }))), "mobilePhone": Schema.optionalKey(Schema.String.check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" }))) }).annotate({ "identifier": "CustomerInfo" })
export type PaymentSession = { readonly "amount": string, readonly "language": "ITA" | "ENG" | "SPA" | "FRA" | "DEU" | "RUS" | "POR" | "JPN" | "ARA" | "ZHA" | "ELL" | "SLV" | "CZE" | "SLK" | "HUN" | "RON" | "POL" | "HRV" | "BOS", readonly "resultUrl"?: string, readonly "cancelUrl"?: string, readonly "notificationUrl": string, readonly "paymentService"?: "CARDS", readonly "captureType"?: "IMPLICIT", readonly "actionType"?: "PAY" | "VERIFY" | "PURCHASE" | "PREAUTH" }
export const PaymentSession = Schema.Struct({ "amount": Schema.String.annotate({ "description": "Amount of the first payment in smallest currency unit." }).check(Schema.isPattern(new globalThis.RegExp("^[0-9]+$", "u")).annotate({ "expected": "a string matching the RegExp ^[0-9]+$" })), "language": Schema.Literals(["ITA", "ENG", "SPA", "FRA", "DEU", "RUS", "POR", "JPN", "ARA", "ZHA", "ELL", "SLV", "CZE", "SLK", "HUN", "RON", "POL", "HRV", "BOS"]).annotate({ "description": "ISO 639-2 language of the hosted payment page, from Nexi's language encoding table." }), "resultUrl": Schema.optionalKey(Schema.String.annotate({ "format": "uri" })), "cancelUrl": Schema.optionalKey(Schema.String.annotate({ "format": "uri" })), "notificationUrl": Schema.String.annotate({ "format": "uri" }), "paymentService": Schema.optionalKey(Schema.Literal("CARDS")), "captureType": Schema.optionalKey(Schema.Literal("IMPLICIT")), "actionType": Schema.optionalKey(Schema.Literals(["PAY", "VERIFY", "PURCHASE", "PREAUTH"])) }).annotate({ "description": "Nexi marks notificationUrl optional, but this wrapper requires it for server-authoritative fulfillment.", "identifier": "PaymentSession" })
export type CreateHostedPaymentPageResponse = { readonly "hostedPage": string, readonly "securityToken": string, readonly "orderId"?: string }
export const CreateHostedPaymentPageResponse = Schema.Struct({ "hostedPage": Schema.String.annotate({ "format": "uri" }), "securityToken": Schema.String.check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })), "orderId": Schema.optionalKey(Schema.String) }).annotate({ "identifier": "CreateHostedPaymentPageResponse" })
export type Amount = { readonly "amount": string, readonly "currency": string }
export const Amount = Schema.Struct({ "amount": Schema.String.annotate({ "description": "Integer minor-unit/scaled amount string." }).check(Schema.isPattern(new globalThis.RegExp("^[0-9]+$", "u")).annotate({ "expected": "a string matching the RegExp ^[0-9]+$" })), "currency": Schema.String.check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" })) }).annotate({ "description": "Monetary amount as an integer minor-unit/scaled amount string, e.g. 5000 means 50.00 for currencies with two decimal places.", "identifier": "Amount" })
export type OrderStatus = { readonly "authorizedAmount"?: string, readonly "capturedAmount"?: string, readonly "lastOperationTime"?: string, readonly "lastOperationType"?: string, readonly "order": OrderStatusOrder }
export const OrderStatus = Schema.Struct({ "authorizedAmount": Schema.optionalKey(Schema.String), "capturedAmount": Schema.optionalKey(Schema.String), "lastOperationTime": Schema.optionalKey(Schema.String), "lastOperationType": Schema.optionalKey(Schema.String), "order": OrderStatusOrder }).annotate({ "identifier": "OrderStatus" })
export type CreateHostedPaymentPageRequest = { readonly "order": { readonly "orderId": string, readonly "amount": string, readonly "currency"?: string, readonly "customerId"?: string, readonly "customerInfo"?: CustomerInfo }, readonly "paymentSession": PaymentSession, readonly "paymentService"?: "CARDS", readonly "captureType"?: "IMPLICIT" }
export const CreateHostedPaymentPageRequest = Schema.Struct({ "order": Schema.Struct({ "orderId": Schema.String, "amount": Schema.String.annotate({ "description": "Transaction amount in smallest currency unit." }).check(Schema.isPattern(new globalThis.RegExp("^[0-9]+$", "u")).annotate({ "expected": "a string matching the RegExp ^[0-9]+$" })), "currency": Schema.optionalKey(Schema.String.check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" }))), "customerId": Schema.optionalKey(Schema.String), "customerInfo": Schema.optionalKey(CustomerInfo) }), "paymentSession": PaymentSession, "paymentService": Schema.optionalKey(Schema.Literal("CARDS")), "captureType": Schema.optionalKey(Schema.Literal("IMPLICIT")) }).annotate({ "identifier": "CreateHostedPaymentPageRequest" })
export type Operation = { readonly "orderId"?: string, readonly "operationId"?: string, readonly "channel"?: string, readonly "operationType"?: string, readonly "operationResult"?: string, readonly "amount"?: Amount, readonly "operationAmount"?: string, readonly "operationCurrency"?: string, readonly "securityToken"?: string, readonly "operationTime"?: string, readonly "cancelledOperationId"?: string }
export const Operation = Schema.Struct({ "orderId": Schema.optionalKey(Schema.String), "operationId": Schema.optionalKey(Schema.String), "channel": Schema.optionalKey(Schema.String), "operationType": Schema.optionalKey(Schema.String), "operationResult": Schema.optionalKey(Schema.String), "amount": Schema.optionalKey(Amount), "operationAmount": Schema.optionalKey(Schema.String.check(Schema.isPattern(new globalThis.RegExp("^[0-9]+$", "u")).annotate({ "expected": "a string matching the RegExp ^[0-9]+$" }))), "operationCurrency": Schema.optionalKey(Schema.String.check(Schema.isMinCodePoints(3).annotate({ "expected": "a string with at least 3 code points" })).check(Schema.isMaxCodePoints(3).annotate({ "expected": "a string with at most 3 code points" }))), "securityToken": Schema.optionalKey(Schema.String), "operationTime": Schema.optionalKey(Schema.String), "cancelledOperationId": Schema.optionalKey(Schema.String) }).annotate({ "identifier": "Operation" })
export type OrderListResponse = { readonly "orders"?: ReadonlyArray<OrderStatus> }
export const OrderListResponse = Schema.Struct({ "orders": Schema.optionalKey(Schema.Array(OrderStatus)) }).annotate({ "identifier": "OrderListResponse" })
export type OrderResponse = { readonly "orderId"?: string, readonly "amount"?: Amount, readonly "securityToken"?: string, readonly "orderStatus"?: OrderStatus, readonly "operations"?: ReadonlyArray<Operation> }
export const OrderResponse = Schema.Struct({ "orderId": Schema.optionalKey(Schema.String), "amount": Schema.optionalKey(Amount), "securityToken": Schema.optionalKey(Schema.String), "orderStatus": Schema.optionalKey(OrderStatus), "operations": Schema.optionalKey(Schema.Array(Operation)) }).annotate({ "identifier": "OrderResponse" })
export type OperationListResponse = { readonly "operations"?: ReadonlyArray<Operation> }
export const OperationListResponse = Schema.Struct({ "operations": Schema.optionalKey(Schema.Array(Operation)) }).annotate({ "identifier": "OperationListResponse" })
// schemas
export type ListOrdersParams = { readonly "fromTime"?: string, readonly "toTime"?: string, readonly "maxRecords"?: number, readonly "customField"?: string }
export const ListOrdersParams = Schema.Struct({ "fromTime": Schema.optionalKey(Schema.String), "toTime": Schema.optionalKey(Schema.String), "maxRecords": Schema.optionalKey(Schema.Int), "customField": Schema.optionalKey(Schema.String) })
export type ListOrders200 = OrderListResponse
export const ListOrders200 = OrderListResponse
export type ListOrdersdefault = ErrorResponse
export const ListOrdersdefault = ErrorResponse
export type CreateHostedPaymentPageRequestJson = CreateHostedPaymentPageRequest
export const CreateHostedPaymentPageRequestJson = CreateHostedPaymentPageRequest
export type CreateHostedPaymentPage200 = CreateHostedPaymentPageResponse
export const CreateHostedPaymentPage200 = CreateHostedPaymentPageResponse
export type CreateHostedPaymentPagedefault = ErrorResponse
export const CreateHostedPaymentPagedefault = ErrorResponse
export type GetOrder200 = OrderResponse
export const GetOrder200 = OrderResponse
export type GetOrderdefault = ErrorResponse
export const GetOrderdefault = ErrorResponse
export type ListOperationsParams = { readonly "fromTime"?: string, readonly "toTime"?: string, readonly "maxRecords"?: number, readonly "channel"?: string, readonly "operationType"?: string, readonly "customField"?: string }
export const ListOperationsParams = Schema.Struct({ "fromTime": Schema.optionalKey(Schema.String), "toTime": Schema.optionalKey(Schema.String), "maxRecords": Schema.optionalKey(Schema.Int), "channel": Schema.optionalKey(Schema.String), "operationType": Schema.optionalKey(Schema.String), "customField": Schema.optionalKey(Schema.String) })
export type ListOperations200 = OperationListResponse
export const ListOperations200 = OperationListResponse
export type ListOperationsdefault = ErrorResponse
export const ListOperationsdefault = ErrorResponse
export type GetOperation200 = Operation
export const GetOperation200 = Operation
export type GetOperationdefault = ErrorResponse
export const GetOperationdefault = ErrorResponse

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig | undefined> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse]
  : Config extends { readonly includeResponse?: false | undefined } | undefined ? A
  : A | [A, HttpClientResponse.HttpClientResponse]

export const make = <E, R>(
  httpClient: HttpClient.HttpClient.With<E, R>,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient.With<E, R>) => Effect.Effect<HttpClient.HttpClient.With<E, R>>) | undefined
  } = {}
): NexiClient<E, R> => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any, R> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const __encodePathParam = encodeURIComponent
  const __makePathRequest = (
    method: (url: string) => HttpClientRequest.HttpClientRequest,
    parameters: ReadonlyArray<string>,
    getPath: () => string,
  ) => Effect.suspend(() => {
    const fail = (description: string, cause?: unknown) => Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.InvalidUrlError({
          request: method(""),
          cause,
          description,
        }),
      }),
    )
    if (parameters.some((value) => value === "" || /^(?:\.|%2e){1,2}$/i.test(value))) {
      return fail("Path parameters must be non-empty and cannot be dot segments")
    }
    let path: string
    try {
      path = getPath()
    } catch (cause) {
      return fail("Failed to encode path parameter", cause)
    }
    if (path.split("/").some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) {
      return fail("Request paths cannot contain dot segments")
    }
    return Effect.succeed(method(path))
  })
  const decodeSuccess =
    <Schema extends Schema.Constraint>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  return {
    httpClient,
    "listOrders": (options: Parameters<NexiClient["listOrders"]>[0]) => HttpClientRequest.get("/orders").pipe(
      HttpClientRequest.setUrlParams({ "fromTime": options?.params?.["fromTime"] as any, "toTime": options?.params?.["toTime"] as any, "maxRecords": options?.params?.["maxRecords"] as any, "customField": options?.params?.["customField"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ListOrders200),
      orElse: unexpectedStatus
    }))
    ),
    "createHostedPaymentPage": (options: Parameters<NexiClient["createHostedPaymentPage"]>[0]) => HttpClientRequest.post("/orders/hpp").pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateHostedPaymentPage200),
      orElse: unexpectedStatus
    }))
    ),
    "getOrder": (orderId, options: Parameters<NexiClient["getOrder"]>[1]) => __makePathRequest(HttpClientRequest.get, [orderId], () => "/orders/" + __encodePathParam(orderId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetOrder200),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "listOperations": (options: Parameters<NexiClient["listOperations"]>[0]) => HttpClientRequest.get("/operations").pipe(
      HttpClientRequest.setUrlParams({ "fromTime": options?.params?.["fromTime"] as any, "toTime": options?.params?.["toTime"] as any, "maxRecords": options?.params?.["maxRecords"] as any, "channel": options?.params?.["channel"] as any, "operationType": options?.params?.["operationType"] as any, "customField": options?.params?.["customField"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ListOperations200),
      orElse: unexpectedStatus
    }))
    ),
    "getOperation": (operationId, options: Parameters<NexiClient["getOperation"]>[1]) => __makePathRequest(HttpClientRequest.get, [operationId], () => "/operations/" + __encodePathParam(operationId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetOperation200),
      orElse: unexpectedStatus
    }))
    ))
  )
  }
}

export interface NexiClient<E = HttpClientError.HttpClientError, R = never> {
  readonly httpClient: HttpClient.HttpClient.With<E, R>
  /**
* List orders in reverse chronological order
*/
readonly "listOrders": {
    <Config extends OperationConfig | undefined = undefined>(options: { readonly params?: typeof ListOrdersParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<ListOrders200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(options: { readonly params?: typeof ListOrdersParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<ListOrders200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  /**
* Create hosted payment page session
*/
readonly "createHostedPaymentPage": {
    <Config extends OperationConfig | undefined = undefined>(options: { readonly payload: typeof CreateHostedPaymentPageRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<CreateHostedPaymentPage200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(options: { readonly payload: typeof CreateHostedPaymentPageRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<CreateHostedPaymentPage200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  /**
* Get order outcome
*/
readonly "getOrder": {
    <Config extends OperationConfig | undefined = undefined>(orderId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetOrder200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(orderId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetOrder200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  /**
* List operations in a time interval
*/
readonly "listOperations": {
    <Config extends OperationConfig | undefined = undefined>(options: { readonly params?: typeof ListOperationsParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<ListOperations200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(options: { readonly params?: typeof ListOperationsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<ListOperations200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  /**
* Get one operation
*/
readonly "getOperation": {
    <Config extends OperationConfig | undefined = undefined>(operationId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetOperation200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(operationId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetOperation200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
}

export interface NexiClientError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class NexiClientErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const NexiClientError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): NexiClientError<Tag, E> =>
  new NexiClientErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any
