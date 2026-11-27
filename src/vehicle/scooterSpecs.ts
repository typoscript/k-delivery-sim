/* Scooter chassis constants shared by the physics stages (vehicle/physics/*) and the mesh */

/** Walking pace (m/s) at which the rider can push a scooter that ran out of fuel */
export const OUT_OF_FUEL_PUSH_SPEED = 1.5;

export const SCOOTER_SPECS = {
  wheelbase: 1.38,
  wheelRadius: 0.28,
  maxSteerAngle: (36 * Math.PI) / 180,
  maxForwardSpeed: 22.5, // ~81 km/h
  maxReverseSpeed: 1.8, // ~6.5 km/h (foot-push reverse)
  radius: 0.72,
  dryGripLeanLimit: (44 * Math.PI) / 180, // ~44 deg max safe lean before lowside
  brakingLeanLimit: (32 * Math.PI) / 180, // hard braking while leaned reduces grip!
};
