#pragma once
// ============================================================================
// MAYER-VIETORIS COMMUNITY HOMOLOGY ENGINE
// ============================================================================
//
// THE EXACT SEQUENCE (Applied to Residence Life)
// ============================================================================
//
// For an open cover {A, B} of a community X = A ∪ B, the Mayer-Vietoris sequence:
//
// ... → H₁(A∩B) →^{i*} H₁(A) ⊕ H₁(B) →^{j*} H₁(A∪B) →^{∂} H₀(A∩B) →^{i*} H₀(A) ⊕ H₀(B) → ...
//
// The connecting homomorphism ∂: H₁(A∪B) → H₀(A∩B) detects "bridge residents"
// who connect otherwise disconnected subcommunities.
//
// ============================================================================
// APPLICATION TO RESIDENCE LIFE
// ============================================================================
//
// Let A and B be subcommunities (e.g., STEM majors, athletes, gamers).
//
// A ∩ B = Bridge Population = {residents who belong to both A and B}
//
// A "structural hole" in A∪B exists when:
// 1. Residents in A are connected among themselves
// 2. Residents in B are connected among themselves  
// 3. But the path between A and B goes through very few bridge residents
//
// This is EXACTLY what ker(i₀*) detects - components that merge in the union
// but were separate in the intersection.
//
// ============================================================================
// THE THEOREM (Community Version)
// ============================================================================
//
// H¹(A∪B) = 0 ⟺ Community is "simply connected" (no structural holes)
//
// For H¹(A∪B) = 0, we need:
// (1) H¹(A) = 0 (Subcommunity A has no internal cliques with outsiders)
// (2) H¹(B) = 0 (Subcommunity B has no internal cliques with outsiders)
// (3) ker(∂) = im(j*) (Bridge residents adequately connect A and B)
//
// When H¹(A∪B) ≠ 0, the non-trivial cycles represent:
// - Friend groups that exclude others (cliques)
// - Missing connections that SHOULD exist (structural holes)
// - Community fragmentation risk
//
// ============================================================================

#include <vector>
#include <array>
#include <map>
#include <set>
#include <unordered_map>
#include <unordered_set>
#include <memory>
#include <cstdint>
#include <string>
#include <functional>
#include <iostream>
#include <optional>
#include <iomanip>
#include <numeric>
#include <sstream>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <chrono>

namespace community_homology {

// ============================================================================
// TIME UTILITIES
// ============================================================================

struct TimeBlock {
    uint8_t day;           // 0=M, 1=T, 2=W, 3=TH, 4=F, 5=SA, 6=SU
    uint16_t start_min;    // Minutes from midnight (0-1440)
    uint16_t end_min;      // Minutes from midnight
    
    bool overlaps(const TimeBlock& other) const {
        if (day != other.day) return false;
        return !(end_min <= other.start_min || start_min >= other.end_min);
    }
    
    uint16_t overlap_minutes(const TimeBlock& other) const {
        if (!overlaps(other)) return 0;
        uint16_t overlap_start = std::max(start_min, other.start_min);
        uint16_t overlap_end = std::min(end_min, other.end_min);
        return overlap_end - overlap_start;
    }
};

// ============================================================================
// RESIDENT (Vertex in Community Graph)
// ============================================================================

struct Resident {
    uint32_t id;
    std::string name;
    std::string room;
    std::string email;
    std::string phone;
    
    // Subcommunity memberships (for Mayer-Vietoris decomposition)
    std::set<std::string> subcommunities;  // e.g., {"STEM", "athletes", "gamers"}
    
    // Academic data
    std::vector<std::string> classes;       // Course codes
    std::vector<TimeBlock> class_schedule;  // When in class
    std::vector<TimeBlock> free_blocks;     // When available
    
    // Interests (from check-in responses)
    std::set<std::string> interests;        // e.g., {"study_groups", "intramurals"}
    
    // Check-in data
    int last_rating = 0;                    // 1-5 from most recent check-in
    std::set<std::string> concerns;         // Flagged concerns
    bool follow_up_needed = false;
    
    // Computed topological position
    float centrality = 0.0f;                // How central in the graph
    float boundary_score = 0.0f;            // How much on the "edge" (higher = more isolated)
    bool is_bridge = false;                 // Connects otherwise disconnected groups
    int component_id = -1;                  // Which connected component
};

// ============================================================================
// CONNECTION (Edge in Community Graph)  
// ============================================================================

enum class ConnectionType : uint8_t {
    SHARED_CLASS,       // Same course
    SCHEDULE_OVERLAP,   // Free at same times
    SHARED_INTEREST,    // Both flagged same interest
    ROOMMATE,           // Same room
    FLOOR_PROXIMITY,    // Nearby rooms (same wing)
    RA_INTRODUCED,      // RA made introduction
    CHECKIN_MENTION,    // Mentioned each other in check-ins
    SUBCOMMUNITY        // Both in same subcommunity
};

struct Connection {
    uint32_t id;
    uint32_t source;        // Resident ID
    uint32_t target;        // Resident ID
    ConnectionType type;
    float strength;         // Weight (higher = stronger connection)
    bool is_bridge_edge;    // Crosses subcommunity boundary
    
    // For Mayer-Vietoris: which subcommunities does this edge touch?
    std::set<std::string> touches_subcommunities;
};

// ============================================================================
// SPARSE MATRIX FOR BOUNDARY OPERATORS
// ============================================================================

class SparseMatrix {
public:
    size_t rows = 0;
    size_t cols = 0;
    std::map<std::pair<size_t, size_t>, int> entries;

    void set(size_t i, size_t j, int val) {
        if (val != 0) {
            entries[{i, j}] = val;
        } else {
            entries.erase({i, j});
        }
    }

    int get(size_t i, size_t j) const {
        auto it = entries.find({i, j});
        return (it != entries.end()) ? it->second : 0;
    }

    size_t rank() const {
        if (rows == 0 || cols == 0) return 0;

        std::vector<std::vector<double>> mat(rows, std::vector<double>(cols, 0.0));
        for (const auto& [pos, val] : entries) {
            mat[pos.first][pos.second] = static_cast<double>(val);
        }

        size_t r = 0;
        for (size_t c = 0; c < cols && r < rows; ++c) {
            size_t pivot = r;
            for (size_t i = r + 1; i < rows; ++i) {
                if (std::abs(mat[i][c]) > std::abs(mat[pivot][c])) {
                    pivot = i;
                }
            }

            if (std::abs(mat[pivot][c]) < 1e-10) continue;
            std::swap(mat[r], mat[pivot]);

            for (size_t i = r + 1; i < rows; ++i) {
                if (std::abs(mat[i][c]) > 1e-10) {
                    double factor = mat[i][c] / mat[r][c];
                    for (size_t j = c; j < cols; ++j) {
                        mat[i][j] -= factor * mat[r][j];
                    }
                }
            }
            ++r;
        }
        return r;
    }

    size_t kernel_dim() const {
        return cols - rank();
    }
};

// ============================================================================
// COMMUNITY GRAPH (Simplicial Complex)
// ============================================================================

class CommunityGraph {
public:
    std::string community_id;  // e.g., "Floor_3_East" or "STEM_majors"
    std::vector<Resident> residents;
    std::vector<Connection> connections;
    
    // Adjacency for fast lookup
    std::unordered_map<uint32_t, std::vector<uint32_t>> adj;
    std::unordered_map<uint32_t, std::vector<uint32_t>> adj_weighted;  // Only strong connections
    
    // Subcommunity tracking
    std::set<std::string> subcommunity_labels;
    std::map<std::string, std::vector<uint32_t>> subcommunity_members;
    
    // Reachability cache
    mutable std::unordered_map<uint64_t, bool> reachability_cache;
    
    static uint64_t make_cache_key(uint32_t src, uint32_t dst) {
        return (static_cast<uint64_t>(src) << 32) | dst;
    }

    // ========================================================================
    // CONSTRUCTION
    // ========================================================================
    
    void add_resident(const Resident& r) {
        residents.push_back(r);
        for (const auto& sub : r.subcommunities) {
            subcommunity_labels.insert(sub);
            subcommunity_members[sub].push_back(r.id);
        }
    }
    
    void compute_connections(float min_strength = 0.5f) {
        connections.clear();
        adj.clear();
        uint32_t edge_id = 0;
        
        for (size_t i = 0; i < residents.size(); ++i) {
            for (size_t j = i + 1; j < residents.size(); ++j) {
                auto& r1 = residents[i];
                auto& r2 = residents[j];
                
                // Check all connection types
                float total_strength = 0.0f;
                std::vector<ConnectionType> types;
                
                // Shared classes
                int shared_classes = count_shared_classes(r1, r2);
                if (shared_classes > 0) {
                    total_strength += shared_classes * 2.0f;
                    types.push_back(ConnectionType::SHARED_CLASS);
                }
                
                // Schedule overlap
                int overlap_hours = compute_schedule_overlap(r1, r2);
                if (overlap_hours >= 2) {
                    total_strength += std::min(overlap_hours / 5.0f, 2.0f);
                    types.push_back(ConnectionType::SCHEDULE_OVERLAP);
                }
                
                // Shared interests
                int shared_interests = count_shared_interests(r1, r2);
                if (shared_interests > 0) {
                    total_strength += shared_interests * 1.5f;
                    types.push_back(ConnectionType::SHARED_INTEREST);
                }
                
                // Roommates
                if (r1.room == r2.room) {
                    total_strength += 5.0f;
                    types.push_back(ConnectionType::ROOMMATE);
                }
                
                // Floor proximity
                if (are_neighbors(r1.room, r2.room)) {
                    total_strength += 1.0f;
                    types.push_back(ConnectionType::FLOOR_PROXIMITY);
                }
                
                // Shared subcommunities
                std::set<std::string> shared_subs;
                std::set_intersection(
                    r1.subcommunities.begin(), r1.subcommunities.end(),
                    r2.subcommunities.begin(), r2.subcommunities.end(),
                    std::inserter(shared_subs, shared_subs.begin())
                );
                if (!shared_subs.empty()) {
                    total_strength += shared_subs.size() * 0.5f;
                }
                
                // Add connection if strong enough
                if (total_strength >= min_strength && !types.empty()) {
                    Connection c;
                    c.id = edge_id++;
                    c.source = r1.id;
                    c.target = r2.id;
                    c.type = types[0];  // Primary type
                    c.strength = total_strength;
                    c.is_bridge_edge = (shared_subs.size() < r1.subcommunities.size() ||
                                        shared_subs.size() < r2.subcommunities.size());
                    c.touches_subcommunities = shared_subs;
                    
                    connections.push_back(c);
                    adj[r1.id].push_back(r2.id);
                    adj[r2.id].push_back(r1.id);
                    
                    if (total_strength >= 2.0f) {
                        adj_weighted[r1.id].push_back(r2.id);
                        adj_weighted[r2.id].push_back(r1.id);
                    }
                }
            }
        }
    }
    
    // ========================================================================
    // HOMOLOGY COMPUTATIONS
    // ========================================================================
    
    // β₀ = number of connected components
    int h0() const {
        if (residents.empty()) return 0;
        
        std::vector<uint32_t> parent(residents.size());
        std::iota(parent.begin(), parent.end(), 0);
        
        std::function<uint32_t(uint32_t)> find = [&](uint32_t x) -> uint32_t {
            if (parent[x] != x) parent[x] = find(parent[x]);
            return parent[x];
        };
        
        for (const auto& c : connections) {
            parent[find(c.source)] = find(c.target);
        }
        
        std::set<uint32_t> components;
        for (size_t i = 0; i < residents.size(); ++i) {
            components.insert(find(static_cast<uint32_t>(i)));
        }
        
        return static_cast<int>(components.size());
    }
    
    // β₁ = number of independent cycles (structural holes)
    // For a graph: β₁ = |E| - |V| + β₀
    int h1() const {
        int V = static_cast<int>(residents.size());
        int E = static_cast<int>(connections.size());
        int components = h0();
        return E - V + components;
    }
    
    // Find all cycles (generators of H₁)
    std::vector<std::vector<uint32_t>> find_cycles() const {
        std::vector<std::vector<uint32_t>> cycles;
        
        // DFS to find back edges, which create cycles
        std::unordered_set<uint32_t> visited;
        std::unordered_map<uint32_t, uint32_t> parent;
        std::unordered_map<uint32_t, int> depth;
        
        std::function<void(uint32_t, uint32_t, int)> dfs = [&](uint32_t v, uint32_t p, int d) {
            visited.insert(v);
            parent[v] = p;
            depth[v] = d;
            
            auto it = adj.find(v);
            if (it == adj.end()) return;
            
            for (uint32_t u : it->second) {
                if (u == p) continue;
                
                if (visited.count(u)) {
                    // Back edge found - extract cycle
                    if (depth[u] < depth[v]) {
                        std::vector<uint32_t> cycle;
                        uint32_t curr = v;
                        while (curr != u) {
                            cycle.push_back(curr);
                            curr = parent[curr];
                        }
                        cycle.push_back(u);
                        cycles.push_back(cycle);
                    }
                } else {
                    dfs(u, v, d + 1);
                }
            }
        };
        
        for (const auto& r : residents) {
            if (!visited.count(r.id)) {
                dfs(r.id, UINT32_MAX, 0);
            }
        }
        
        return cycles;
    }
    
    // ========================================================================
    // BOUNDARY COMPUTATION (Who's on the edge of the community?)
    // ========================================================================
    
    void compute_boundary_scores() {
        if (residents.empty()) return;
        
        // Compute degree centrality
        std::unordered_map<uint32_t, int> degree;
        for (const auto& c : connections) {
            degree[c.source]++;
            degree[c.target]++;
        }
        
        // Find max degree for normalization
        int max_degree = 0;
        for (const auto& [id, d] : degree) {
            max_degree = std::max(max_degree, d);
        }
        
        // Boundary score = inverse of normalized degree
        // High boundary score = few connections = isolation risk
        for (auto& r : residents) {
            int d = degree.count(r.id) ? degree[r.id] : 0;
            r.centrality = max_degree > 0 ? static_cast<float>(d) / max_degree : 0.0f;
            r.boundary_score = 1.0f - r.centrality;
        }
    }
    
    // Get residents at boundary (isolation risk)
    std::vector<uint32_t> get_boundary_residents(float threshold = 0.7f) const {
        std::vector<uint32_t> boundary;
        for (const auto& r : residents) {
            if (r.boundary_score >= threshold) {
                boundary.push_back(r.id);
            }
        }
        return boundary;
    }
    
    // ========================================================================
    // BRIDGE DETECTION (Residents connecting subcommunities)
    // ========================================================================
    
    void compute_bridges() {
        // A resident is a bridge if removing them increases β₀
        // (disconnects the graph)
        
        // Simplified: residents in multiple subcommunities who connect to
        // members of those different subcommunities
        
        for (auto& r : residents) {
            if (r.subcommunities.size() < 2) {
                r.is_bridge = false;
                continue;
            }
            
            // Check if this resident connects different subcommunities
            std::set<std::string> connected_subs;
            auto it = adj.find(r.id);
            if (it != adj.end()) {
                for (uint32_t neighbor_id : it->second) {
                    for (const auto& sub : residents[neighbor_id].subcommunities) {
                        connected_subs.insert(sub);
                    }
                }
            }
            
            // Bridge if connected to 2+ different subcommunities
            r.is_bridge = (connected_subs.size() >= 2);
        }
    }
    
    std::vector<uint32_t> get_bridge_residents() const {
        std::vector<uint32_t> bridges;
        for (const auto& r : residents) {
            if (r.is_bridge) {
                bridges.push_back(r.id);
            }
        }
        return bridges;
    }
    
    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================
    
private:
    int count_shared_classes(const Resident& r1, const Resident& r2) const {
        int count = 0;
        for (const auto& c1 : r1.classes) {
            for (const auto& c2 : r2.classes) {
                if (c1 == c2) count++;
            }
        }
        return count;
    }
    
    int compute_schedule_overlap(const Resident& r1, const Resident& r2) const {
        int total_minutes = 0;
        for (const auto& b1 : r1.free_blocks) {
            for (const auto& b2 : r2.free_blocks) {
                total_minutes += b1.overlap_minutes(b2);
            }
        }
        return total_minutes / 60;  // Return hours
    }
    
    int count_shared_interests(const Resident& r1, const Resident& r2) const {
        int count = 0;
        for (const auto& i1 : r1.interests) {
            if (r2.interests.count(i1)) count++;
        }
        return count;
    }
    
    bool are_neighbors(const std::string& room1, const std::string& room2) const {
        // Simple heuristic: rooms within 5 numbers of each other
        try {
            int r1 = std::stoi(room1.substr(0, 3));
            int r2 = std::stoi(room2.substr(0, 3));
            return std::abs(r1 - r2) <= 5;
        } catch (...) {
            return false;
        }
    }
};

// ============================================================================
// SUBCOMMUNITY INTERFACE (For Mayer-Vietoris decomposition)
// ============================================================================

struct SubcommunityInterface {
    std::string subcommunity_A;
    std::string subcommunity_B;
    std::vector<uint32_t> bridge_residents;  // Residents in both A and B
    int connection_count;                     // Edges crossing A-B boundary
    float interface_strength;                 // Total weight of bridge edges
};

// ============================================================================
// INTERSECTION GRAPH (A ∩ B in Mayer-Vietoris)
// ============================================================================

class IntersectionGraph {
public:
    std::vector<Resident> residents;  // Residents in both subcommunities
    std::vector<Connection> connections;  // Connections within intersection
    
    static IntersectionGraph compute(
        const CommunityGraph& G,
        const std::string& subA,
        const std::string& subB
    ) {
        IntersectionGraph I;
        
        // Find residents in both subcommunities
        std::set<uint32_t> in_A, in_B;
        if (G.subcommunity_members.count(subA)) {
            for (uint32_t id : G.subcommunity_members.at(subA)) {
                in_A.insert(id);
            }
        }
        if (G.subcommunity_members.count(subB)) {
            for (uint32_t id : G.subcommunity_members.at(subB)) {
                in_B.insert(id);
            }
        }
        
        // Intersection = residents in both
        std::set<uint32_t> in_both;
        std::set_intersection(in_A.begin(), in_A.end(),
                              in_B.begin(), in_B.end(),
                              std::inserter(in_both, in_both.begin()));
        
        // Copy residents
        std::map<uint32_t, uint32_t> id_map;  // old_id -> new_id
        uint32_t new_id = 0;
        for (uint32_t old_id : in_both) {
            Resident r = G.residents[old_id];
            r.id = new_id;
            I.residents.push_back(r);
            id_map[old_id] = new_id++;
        }
        
        // Copy connections within intersection
        uint32_t edge_id = 0;
        for (const auto& c : G.connections) {
            if (in_both.count(c.source) && in_both.count(c.target)) {
                Connection c_copy = c;
                c_copy.id = edge_id++;
                c_copy.source = id_map[c.source];
                c_copy.target = id_map[c.target];
                I.connections.push_back(c_copy);
            }
        }
        
        return I;
    }
    
    int h0() const {
        if (residents.empty()) return 0;
        
        std::vector<uint32_t> parent(residents.size());
        std::iota(parent.begin(), parent.end(), 0);
        
        std::function<uint32_t(uint32_t)> find = [&](uint32_t x) -> uint32_t {
            if (parent[x] != x) parent[x] = find(parent[x]);
            return parent[x];
        };
        
        for (const auto& c : connections) {
            if (c.source < parent.size() && c.target < parent.size()) {
                parent[find(c.source)] = find(c.target);
            }
        }
        
        std::set<uint32_t> components;
        for (size_t i = 0; i < residents.size(); ++i) {
            components.insert(find(static_cast<uint32_t>(i)));
        }
        
        return static_cast<int>(components.size());
    }
    
    int h1() const {
        int V = static_cast<int>(residents.size());
        int E = static_cast<int>(connections.size());
        return E - V + h0();
    }
};

// ============================================================================
// MAYER-VIETORIS ENGINE (Community Version)
// ============================================================================

class MayerVietorisEngine {
public:
    struct Result {
        // Betti numbers
        int h1_A;               // Cycles in subcommunity A
        int h1_B;               // Cycles in subcommunity B
        int h1_intersection;    // Cycles in A ∩ B
        int h0_A;               // Components in A
        int h0_B;               // Components in B
        int h0_intersection;    // Components in A ∩ B
        int h1_union;           // Cycles in total community
        
        // Mayer-Vietoris invariants
        int kernel_i0;          // ker(i₀*) = structural holes from merging
        int cokernel_i1;        // coker(i₁*) = cycles not from subcommunities
        
        // Interpretation
        bool is_cohesive;       // h1_union == 0 means no structural holes
        float community_health; // 0-100 score
        
        // Actionable data
        std::vector<uint32_t> isolation_risk;       // Boundary residents
        std::vector<uint32_t> bridge_residents;     // Connectors
        std::vector<std::vector<uint32_t>> holes;   // Cycles (friend groups with gaps)
        std::vector<std::pair<uint32_t, uint32_t>> suggested_introductions;
        
        std::string diagnosis;
    };
    
    Result compute(
        const CommunityGraph& G,
        const std::string& subA,
        const std::string& subB
    ) {
        Result r;
        
        // Build subgraphs
        CommunityGraph G_A = extract_subcommunity(G, subA);
        CommunityGraph G_B = extract_subcommunity(G, subB);
        IntersectionGraph I = IntersectionGraph::compute(G, subA, subB);
        
        // Compute Betti numbers
        r.h1_A = G_A.h1();
        r.h1_B = G_B.h1();
        r.h1_intersection = I.h1();
        r.h0_A = G_A.h0();
        r.h0_B = G_B.h0();
        r.h0_intersection = I.h0();
        
        // Mayer-Vietoris computation
        // ker(i₀*) = components in A∩B that merge in A⊕B
        r.kernel_i0 = compute_kernel_i0(G_A, G_B, I);
        
        // coker(i₁*) = cycles in A⊕B not coming from A∩B
        r.cokernel_i1 = r.h1_A + r.h1_B - std::min(r.h1_intersection, r.h1_A + r.h1_B);
        
        // h1(A∪B) = coker(i₁*) + ker(i₀*)
        // But for graphs, we can compute directly:
        r.h1_union = G.h1();
        
        r.is_cohesive = (r.h1_union <= 1);  // Allow one cycle (some structure is good)
        
        // Compute health score
        r.community_health = compute_health_score(G, r);
        
        // Find actionable items
        r.isolation_risk = G.get_boundary_residents(0.7f);
        r.bridge_residents = G.get_bridge_residents();
        r.holes = G.find_cycles();
        r.suggested_introductions = compute_introductions(G, r.holes, r.isolation_risk);
        
        // Build diagnosis
        build_diagnosis(r, G, subA, subB, I);
        
        return r;
    }
    
    // Compute for entire community (automatic decomposition)
    Result compute_full(CommunityGraph& G) {
        Result r;
        
        G.compute_connections();
        G.compute_boundary_scores();
        G.compute_bridges();
        
        r.h1_union = G.h1();
        r.h0_A = G.h0();  // Using h0_A for total components
        r.is_cohesive = (r.h1_union <= static_cast<int>(G.residents.size()) / 10);
        
        // Health score components
        float connectivity_score = std::max(0.0f, 100.0f - (G.h0() - 1) * 20.0f);
        float cohesion_score = std::max(0.0f, 100.0f - r.h1_union * 5.0f);
        
        // Boundary score (fewer isolated = better)
        auto boundary = G.get_boundary_residents(0.7f);
        float isolation_score = std::max(0.0f, 
            100.0f - (static_cast<float>(boundary.size()) / G.residents.size()) * 100.0f);
        
        r.community_health = (connectivity_score * 0.3f + 
                              cohesion_score * 0.3f + 
                              isolation_score * 0.4f);
        
        r.isolation_risk = boundary;
        r.bridge_residents = G.get_bridge_residents();
        r.holes = G.find_cycles();
        r.suggested_introductions = compute_introductions(G, r.holes, r.isolation_risk);
        
        std::ostringstream oss;
        oss << "Community: " << G.residents.size() << " residents, "
            << G.connections.size() << " connections\n";
        oss << "Components (β₀): " << G.h0() << "\n";
        oss << "Structural holes (β₁): " << r.h1_union << "\n";
        oss << "Isolation risk: " << boundary.size() << " residents\n";
        oss << "Bridge residents: " << r.bridge_residents.size() << "\n";
        oss << "Health score: " << std::fixed << std::setprecision(1) << r.community_health << "/100\n";
        r.diagnosis = oss.str();
        
        return r;
    }
    
    static void print(const Result& r, std::ostream& os = std::cout) {
        os << "\n=== COMMUNITY HOMOLOGY ===\n";
        os << "Health Score: " << std::fixed << std::setprecision(1) << r.community_health << "/100\n";
        os << "Cohesive: " << (r.is_cohesive ? "YES" : "NO") << "\n";
        os << "\nTopological Invariants:\n";
        os << "  β₀ (components): " << r.h0_A << "\n";
        os << "  β₁ (holes): " << r.h1_union << "\n";
        os << "\nRisk Assessment:\n";
        os << "  Isolation risk: " << r.isolation_risk.size() << " residents\n";
        os << "  Bridge residents: " << r.bridge_residents.size() << "\n";
        os << "  Structural holes: " << r.holes.size() << "\n";
        os << "\nSuggested Introductions: " << r.suggested_introductions.size() << "\n";
        os << "\n" << r.diagnosis;
    }
    
private:
    CommunityGraph extract_subcommunity(const CommunityGraph& G, const std::string& sub) {
        CommunityGraph S;
        S.community_id = sub;
        
        if (!G.subcommunity_members.count(sub)) return S;
        
        std::set<uint32_t> member_ids;
        std::map<uint32_t, uint32_t> id_map;
        uint32_t new_id = 0;
        
        for (uint32_t old_id : G.subcommunity_members.at(sub)) {
            member_ids.insert(old_id);
            Resident r = G.residents[old_id];
            r.id = new_id;
            S.residents.push_back(r);
            id_map[old_id] = new_id++;
        }
        
        uint32_t edge_id = 0;
        for (const auto& c : G.connections) {
            if (member_ids.count(c.source) && member_ids.count(c.target)) {
                Connection c_copy = c;
                c_copy.id = edge_id++;
                c_copy.source = id_map[c.source];
                c_copy.target = id_map[c.target];
                S.connections.push_back(c_copy);
            }
        }
        
        return S;
    }
    
    int compute_kernel_i0(
        const CommunityGraph& A,
        const CommunityGraph& B,
        const IntersectionGraph& I
    ) {
        // ker(i₀*) counts components in A∩B that become connected in A∪B
        // This represents "structural holes that get filled by bridge residents"
        
        int components_intersection = I.h0();
        
        // In the union, some of these components merge
        // The kernel dimension is how many merge
        // Simplified: if intersection is disconnected but A and B each provide
        // paths, those paths create the kernel
        
        if (components_intersection <= 1) return 0;
        
        // Estimate: each component in intersection beyond the first could merge
        // if there are paths through A or B
        return std::max(0, components_intersection - std::max(A.h0(), B.h0()));
    }
    
    float compute_health_score(const CommunityGraph& G, const Result& r) {
        // Components: ideal is 1 (everyone connected)
        float component_penalty = (G.h0() - 1) * 15.0f;
        
        // Holes: some is okay (friend groups), too many is fragmented
        float hole_penalty = std::max(0.0f, (r.h1_union - 2) * 5.0f);
        
        // Isolation: penalize heavily
        float isolation_penalty = static_cast<float>(r.isolation_risk.size()) * 3.0f;
        
        // Bridge bonus: having bridges is good
        float bridge_bonus = static_cast<float>(r.bridge_residents.size()) * 2.0f;
        
        float score = 100.0f - component_penalty - hole_penalty - isolation_penalty + bridge_bonus;
        return std::max(0.0f, std::min(100.0f, score));
    }
    
    std::vector<std::pair<uint32_t, uint32_t>> compute_introductions(
        const CommunityGraph& G,
        const std::vector<std::vector<uint32_t>>& holes,
        const std::vector<uint32_t>& isolated
    ) {
        std::vector<std::pair<uint32_t, uint32_t>> intros;
        
        // Priority 1: Connect isolated residents to well-connected ones
        for (uint32_t iso_id : isolated) {
            const Resident& iso = G.residents[iso_id];
            
            // Find a well-connected resident with shared context
            for (const auto& r : G.residents) {
                if (r.id == iso_id) continue;
                if (r.boundary_score > 0.5f) continue;  // Also isolated
                
                // Check for shared context
                bool has_shared_class = false;
                for (const auto& c : iso.classes) {
                    if (std::find(r.classes.begin(), r.classes.end(), c) != r.classes.end()) {
                        has_shared_class = true;
                        break;
                    }
                }
                
                bool has_shared_interest = false;
                for (const auto& i : iso.interests) {
                    if (r.interests.count(i)) {
                        has_shared_interest = true;
                        break;
                    }
                }
                
                if (has_shared_class || has_shared_interest) {
                    intros.push_back({iso_id, r.id});
                    break;  // One intro per isolated resident
                }
            }
        }
        
        // Priority 2: Fill structural holes
        for (const auto& hole : holes) {
            if (hole.size() < 3) continue;
            
            // Find someone not in the hole who could connect to 2+ members
            for (const auto& r : G.residents) {
                if (std::find(hole.begin(), hole.end(), r.id) != hole.end()) continue;
                
                int connections_to_hole = 0;
                uint32_t connect_to = UINT32_MAX;
                
                for (uint32_t hole_member : hole) {
                    // Check if could connect (shared class/interest)
                    const Resident& hm = G.residents[hole_member];
                    
                    for (const auto& c : r.classes) {
                        if (std::find(hm.classes.begin(), hm.classes.end(), c) != hm.classes.end()) {
                            connections_to_hole++;
                            connect_to = hole_member;
                            break;
                        }
                    }
                }
                
                if (connections_to_hole >= 2 && connect_to != UINT32_MAX) {
                    intros.push_back({r.id, connect_to});
                    break;
                }
            }
        }
        
        return intros;
    }
    
    void build_diagnosis(
        Result& r,
        const CommunityGraph& G,
        const std::string& subA,
        const std::string& subB,
        const IntersectionGraph& I
    ) {
        std::ostringstream oss;
        
        oss << "=== Mayer-Vietoris Decomposition ===\n";
        oss << "Subcommunity A (" << subA << "): H₁=" << r.h1_A << ", H₀=" << r.h0_A << "\n";
        oss << "Subcommunity B (" << subB << "): H₁=" << r.h1_B << ", H₀=" << r.h0_B << "\n";
        oss << "Intersection (A∩B): " << I.residents.size() << " residents, "
            << "H₁=" << r.h1_intersection << ", H₀=" << r.h0_intersection << "\n";
        oss << "\n";
        oss << "Exact Sequence Analysis:\n";
        oss << "  ker(i₀*) = " << r.kernel_i0 << " (components merged by bridges)\n";
        oss << "  coker(i₁*) = " << r.cokernel_i1 << " (new cycles in union)\n";
        oss << "  H₁(A∪B) = " << r.h1_union << "\n";
        oss << "\n";
        
        if (r.h1_union > 0) {
            oss << "⚠ Structural holes detected. Community has gaps.\n";
            oss << "Recommended: " << r.suggested_introductions.size() << " introductions to fill holes.\n";
        } else {
            oss << "✓ Community is simply connected. No structural holes.\n";
        }
        
        if (r.isolation_risk.size() > 0) {
            oss << "⚠ " << r.isolation_risk.size() << " residents at isolation risk (boundary).\n";
        }
        
        r.diagnosis = oss.str();
    }
};

// ============================================================================
// PERSISTENT HOMOLOGY (Track community evolution over time)
// ============================================================================

struct Barcode {
    int dimension;              // 0 = component, 1 = hole
    float birth;                // When feature appeared (filtration parameter)
    float death;                // When feature disappeared (INFINITY if still alive)
    std::vector<uint32_t> residents;  // Who's involved
    float persistence() const { return death - birth; }
};

class PersistentHomology {
public:
    struct Result {
        std::vector<Barcode> barcodes;
        std::vector<std::vector<uint32_t>> stable_groups;    // Long-lived
        std::vector<std::vector<uint32_t>> fragile_groups;   // Short-lived
        std::vector<std::vector<uint32_t>> emerging_groups;  // Recently formed
    };
    
    // Compute persistence by varying connection strength threshold
    Result compute(const CommunityGraph& G, 
                   float min_strength = 0.0f, 
                   float max_strength = 10.0f,
                   int steps = 20) {
        Result r;
        
        // Build filtration: add edges in order of decreasing strength
        // (Strong connections first, weak connections last)
        
        std::vector<Connection> sorted_connections = G.connections;
        std::sort(sorted_connections.begin(), sorted_connections.end(),
                  [](const Connection& a, const Connection& b) {
                      return a.strength > b.strength;
                  });
        
        // Union-Find for tracking components
        std::vector<uint32_t> parent(G.residents.size());
        std::iota(parent.begin(), parent.end(), 0);
        std::vector<float> birth_time(G.residents.size(), 0.0f);
        
        std::function<uint32_t(uint32_t)> find = [&](uint32_t x) -> uint32_t {
            if (parent[x] != x) parent[x] = find(parent[x]);
            return parent[x];
        };
        
        float max_conn_strength = sorted_connections.empty() ? 1.0f : sorted_connections[0].strength;
        
        for (const auto& c : sorted_connections) {
            uint32_t root_s = find(c.source);
            uint32_t root_t = find(c.target);
            
            if (root_s != root_t) {
                // Two components merging - one "dies"
                float filtration_value = max_conn_strength - c.strength;
                
                Barcode b;
                b.dimension = 0;
                b.birth = birth_time[root_t];
                b.death = filtration_value;
                
                // Collect residents in dying component
                for (size_t i = 0; i < G.residents.size(); ++i) {
                    if (find(static_cast<uint32_t>(i)) == root_t) {
                        b.residents.push_back(static_cast<uint32_t>(i));
                    }
                }
                
                if (b.residents.size() > 1) {
                    r.barcodes.push_back(b);
                }
                
                parent[root_t] = root_s;
            }
        }
        
        // Classify by persistence
        float persistence_threshold = max_conn_strength * 0.3f;
        
        for (const auto& b : r.barcodes) {
            if (b.persistence() > persistence_threshold * 2) {
                r.stable_groups.push_back(b.residents);
            } else if (b.persistence() < persistence_threshold * 0.5f) {
                r.fragile_groups.push_back(b.residents);
            }
        }
        
        return r;
    }
};

// ============================================================================
// SCHEDULING OPTIMIZER (Use topology for optimal event timing)
// ============================================================================

class SchedulingOptimizer {
public:
    struct TimeSlotScore {
        TimeBlock slot;
        int available_count;
        float community_coverage;  // What fraction of community is available
        float topology_score;      // Bonus for including bridge residents / isolated
        std::vector<uint32_t> available_residents;
    };
    
    std::vector<TimeSlotScore> find_optimal_event_times(
        const CommunityGraph& G,
        int top_n = 5
    ) {
        std::vector<TimeSlotScore> scores;
        
        // Generate candidate time slots (hourly blocks)
        for (uint8_t day = 0; day < 7; ++day) {
            for (uint16_t hour = 8; hour < 22; ++hour) {
                TimeBlock slot;
                slot.day = day;
                slot.start_min = hour * 60;
                slot.end_min = (hour + 1) * 60;
                
                TimeSlotScore score;
                score.slot = slot;
                score.available_count = 0;
                
                // Count available residents
                for (const auto& r : G.residents) {
                    for (const auto& free : r.free_blocks) {
                        if (free.overlaps(slot)) {
                            score.available_residents.push_back(r.id);
                            score.available_count++;
                            break;
                        }
                    }
                }
                
                if (score.available_count < 5) continue;  // Skip low-attendance slots
                
                score.community_coverage = static_cast<float>(score.available_count) / G.residents.size();
                
                // Topology bonus: prefer times when isolated/bridge residents are free
                float topo_bonus = 0.0f;
                for (uint32_t id : score.available_residents) {
                    const Resident& r = G.residents[id];
                    if (r.boundary_score > 0.7f) topo_bonus += 2.0f;  // Isolated resident
                    if (r.is_bridge) topo_bonus += 1.5f;  // Bridge resident
                }
                score.topology_score = topo_bonus;
                
                scores.push_back(score);
            }
        }
        
        // Sort by combined score
        std::sort(scores.begin(), scores.end(), [](const TimeSlotScore& a, const TimeSlotScore& b) {
            float score_a = a.community_coverage * 100 + a.topology_score;
            float score_b = b.community_coverage * 100 + b.topology_score;
            return score_a > score_b;
        });
        
        if (scores.size() > static_cast<size_t>(top_n)) {
            scores.resize(top_n);
        }
        
        return scores;
    }
};

// ============================================================================
// COMPLETE ANALYSIS PIPELINE
// ============================================================================

struct CommunityAnalysis {
    MayerVietorisEngine::Result homology;
    PersistentHomology::Result persistence;
    std::vector<SchedulingOptimizer::TimeSlotScore> optimal_event_times;
    
    // Priority-ordered check-in list
    std::vector<std::pair<uint32_t, float>> prioritized_checkins;  // (resident_id, priority_score)
    
    // Summary metrics
    float health_score;
    int isolation_count;
    int bridge_count;
    int hole_count;
};

class CommunityAnalyzer {
public:
    CommunityAnalysis analyze(CommunityGraph& G) {
        CommunityAnalysis result;
        
        // Compute connections and topology
        G.compute_connections();
        G.compute_boundary_scores();
        G.compute_bridges();
        
        // Homology analysis
        MayerVietorisEngine mv;
        result.homology = mv.compute_full(G);
        
        // Persistence analysis
        PersistentHomology ph;
        result.persistence = ph.compute(G);
        
        // Scheduling optimization
        SchedulingOptimizer so;
        result.optimal_event_times = so.find_optimal_event_times(G);
        
        // Priority ordering for check-ins
        result.prioritized_checkins = compute_priority_order(G, result.homology, result.persistence);
        
        // Summary
        result.health_score = result.homology.community_health;
        result.isolation_count = static_cast<int>(result.homology.isolation_risk.size());
        result.bridge_count = static_cast<int>(result.homology.bridge_residents.size());
        result.hole_count = static_cast<int>(result.homology.holes.size());
        
        return result;
    }
    
private:
    std::vector<std::pair<uint32_t, float>> compute_priority_order(
        const CommunityGraph& G,
        const MayerVietorisEngine::Result& homology,
        const PersistentHomology::Result& persistence
    ) {
        std::vector<std::pair<uint32_t, float>> priorities;
        
        std::set<uint32_t> isolated_set(homology.isolation_risk.begin(), homology.isolation_risk.end());
        std::set<uint32_t> bridge_set(homology.bridge_residents.begin(), homology.bridge_residents.end());
        
        std::set<uint32_t> fragile_set;
        for (const auto& group : persistence.fragile_groups) {
            for (uint32_t id : group) fragile_set.insert(id);
        }
        
        for (const auto& r : G.residents) {
            float priority = 50.0f;  // Base
            
            // HIGHEST: Isolation risk
            if (isolated_set.count(r.id)) {
                priority += 30.0f;
            }
            
            // HIGH: In fragile group
            if (fragile_set.count(r.id)) {
                priority += 20.0f;
            }
            
            // MEDIUM: Low check-in rating
            if (r.last_rating > 0 && r.last_rating <= 2) {
                priority += 25.0f;
            }
            
            // MEDIUM: Has concerns flagged
            if (r.follow_up_needed) {
                priority += 15.0f;
            }
            
            // LOWER: Bridge resident (important but not urgent)
            if (bridge_set.count(r.id)) {
                priority += 5.0f;
            }
            
            // LOWER: In stable group
            bool in_stable = false;
            for (const auto& group : persistence.stable_groups) {
                if (std::find(group.begin(), group.end(), r.id) != group.end()) {
                    in_stable = true;
                    break;
                }
            }
            if (in_stable) {
                priority -= 10.0f;
            }
            
            priorities.push_back({r.id, priority});
        }
        
        // Sort by priority (highest first)
        std::sort(priorities.begin(), priorities.end(),
                  [](const auto& a, const auto& b) { return a.second > b.second; });
        
        return priorities;
    }
};

// ============================================================================
// THE THEOREMS (Community Version)
// ============================================================================
//
// THEOREM 1: Community Cohesion
// H¹(Community) = 0 ⟺ No structural holes exist
//
// When H¹ ≠ 0, the generators of H¹ are exactly the "friend group boundaries"
// where introductions could strengthen community structure.
//
// THEOREM 2: Isolation Detection  
// A resident r is "at boundary" ⟺ r has high boundary score
// ⟺ r contributes to ker(∂) in Mayer-Vietoris
// ⟺ r is at risk of isolation
//
// THEOREM 3: Bridge Identification
// A resident r is a "bridge" ⟺ removing r increases β₀
// ⟺ r is critical for community connectivity
// ⟺ r should be supported/retained
//
// THEOREM 4: Persistence = Stability
// A feature (component/hole) with high persistence is STABLE
// A feature with low persistence is FRAGILE and may dissolve
//
// APPLICATION:
// - Check boundary residents FIRST (prevent isolation)
// - Support bridge residents (maintain connectivity)
// - Fill holes with targeted introductions (improve cohesion)
// - Schedule events when topology-important residents are free
//
// ============================================================================

}  // namespace community_homology
