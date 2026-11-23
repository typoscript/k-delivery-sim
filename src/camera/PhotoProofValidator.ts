import * as THREE from 'three';

export interface ObjectFrameCheck {
  inFrustum: boolean;
  inCenterZone: boolean; // within central 60% screen area (|ndc.x| <= 0.6, |ndc.y| <= 0.6)
  valid: boolean;
  ndcX: number;
  ndcY: number;
}

export interface PhotoProofResult {
  valid: boolean;
  food: ObjectFrameCheck;
  plate: ObjectFrameCheck;
  reason: string;
}

// Central 60% of the [-1, +1] NDC viewport = [-0.6, +0.6] on both axes
export const CENTER_ZONE_NDC_LIMIT = 0.6;

// Reusable scratch objects (zero per-frame GC allocations!)
const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _toObj = new THREE.Vector3();
const _corner = new THREE.Vector3();

/**
 * Checks whether a 3D mesh's bounding box lies inside the camera frustum
 * and its center projects inside the central 60% screen region using vector.project(camera).
 */
function checkObjectInViewfinder(
  camera: THREE.Camera,
  object: THREE.Object3D
): ObjectFrameCheck {
  object.updateWorldMatrix(true, true);
  _box.setFromObject(object);

  if (_box.isEmpty()) {
    return { inFrustum: false, inCenterZone: false, valid: false, ndcX: 0, ndcY: 0 };
  }

  _box.getCenter(_center);
  camera.getWorldPosition(_camPos);
  camera.getWorldDirection(_camDir);

  // Reject objects behind the camera plane before projection
  _toObj.subVectors(_center, _camPos);
  if (_toObj.dot(_camDir) <= 0.05) {
    return { inFrustum: false, inCenterZone: false, valid: false, ndcX: 99, ndcY: 99 };
  }

  // Project world center to Normalized Device Coordinates [-1, +1]
  _center.project(camera);
  const ndcX = _center.x;
  const ndcY = _center.y;
  const centerInDepth = _center.z >= -1 && _center.z <= 1;
  const inCenterZone =
    centerInDepth &&
    Math.abs(ndcX) <= CENTER_ZONE_NDC_LIMIT &&
    Math.abs(ndcY) <= CENTER_ZONE_NDC_LIMIT;

  // Project all 8 bounding box corners to verify the object is not clipped outside the camera frustum
  const min = _box.min;
  const max = _box.max;
  let allCornersInFrustum = centerInDepth;

  if (allCornersInFrustum) {
    outer: for (let ix = 0; ix < 2; ix++) {
      const cx = ix === 0 ? min.x : max.x;
      for (let iy = 0; iy < 2; iy++) {
        const cy = iy === 0 ? min.y : max.y;
        for (let iz = 0; iz < 2; iz++) {
          const cz = iz === 0 ? min.z : max.z;
          _corner.set(cx, cy, cz);
          _toObj.subVectors(_corner, _camPos);
          if (_toObj.dot(_camDir) <= 0.02) {
            allCornersInFrustum = false;
            break outer;
          }
          _corner.project(camera);
          if (
            _corner.z < -1 ||
            _corner.z > 1 ||
            Math.abs(_corner.x) > 0.96 ||
            Math.abs(_corner.y) > 0.96
          ) {
            allCornersInFrustum = false;
            break outer;
          }
        }
      }
    }
  }

  return {
    inFrustum: allCornersInFrustum,
    inCenterZone,
    valid: allCornersInFrustum && inCenterZone,
    ndcX,
    ndcY,
  };
}

/**
 * Validates that both required proof elements (floor food bag + door unit plaque)
 * are framed inside the camera frustum and central 60% viewfinder area.
 */
export function validateDeliveryPhotoFrame(
  camera: THREE.Camera,
  foodBagMesh: THREE.Object3D,
  doorPlateMesh: THREE.Object3D
): PhotoProofResult {
  camera.updateMatrixWorld(true);
  const food = checkObjectInViewfinder(camera, foodBagMesh);
  const plate = checkObjectInViewfinder(camera, doorPlateMesh);
  const valid = food.valid && plate.valid;

  let reason = '촬영 가능 (호수 팻말 + 음식 봉투 확인)';
  if (!food.valid && !plate.valid) {
    reason = '현관문 호수와 음식 봉투가 모두 중앙 프레임에 들어오도록 한 걸음 뒤로 물러나세요!';
  } else if (!plate.valid) {
    reason = '현관문 상단 호수 팻말이 잘렸습니다! 카메라를 살짝 올리거나 뒤로 물러나세요.';
  } else if (!food.valid) {
    reason = '바닥의 음식 봉투가 화각 밖에 있습니다! 카메라를 살짝 내리거나 뒤로 물러나세요.';
  }

  return { valid, food, plate, reason };
}
