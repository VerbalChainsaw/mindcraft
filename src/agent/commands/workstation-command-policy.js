export function mayBindExactWorkstation(request) {
  return request?.routeOrigin !== 'model-selected';
}
