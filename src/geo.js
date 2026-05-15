// Haversine distance in metres
export function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Fast, low-accuracy fix for initial map display (IP/WiFi — resolves in ~1s)
export function getFastPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 60000,
      timeout: 12000,
    })
  })
}

export function watchPosition(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError(new Error('Geolocation not supported'))
    return null
  }
  return navigator.geolocation.watchPosition(onSuccess, onError, {
    enableHighAccuracy: false,
    maximumAge: 10000,
    timeout: 10000,
  })
}
